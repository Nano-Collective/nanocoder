import type {LanguageModel} from 'ai';
import {
	generateText,
	InvalidToolInputError,
	NoSuchToolError,
	stepCountIs,
	ToolCallRepairError,
} from 'ai';
import {MAX_TOOL_STEPS} from '@/constants';
import type {
	AIProviderConfig,
	AISDKCoreTool,
	LLMChatResponse,
	Message,
	ModeOverrides,
	StreamCallbacks,
	ToolCall,
} from '@/types/index';
import {
	endMetrics,
	formatMemoryUsage,
	generateCorrelationId,
	getCorrelationId,
	getLogger,
	startMetrics,
	withNewCorrelationContext,
} from '@/utils/logging';
import {getSafeMemory} from '@/utils/logging/safe-process.js';
import {convertToModelMessages} from '../converters/message-converter.js';
import {convertAISDKToolCalls} from '../converters/tool-converter.js';
import {extractRootError} from '../error-handling/error-extractor.js';
import {parseAPIError} from '../error-handling/error-parser.js';
import {isToolSupportError} from '../error-handling/tool-error-detector.js';
import {formatToolsForPrompt} from '../tools/tool-prompt-formatter.js';
import {
	createOnStepFinishHandler,
	createPrepareStepHandler,
} from './streaming-handler.js';

/**
 * Recursively removes 'description' and 'example' fields from a JSON schema
 * to reduce token usage and cognitive load for small models.
 */
// biome-ignore lint/suspicious/noExplicitAny: Necessary for generic JSON schema transformation
export function simplifyToolSchema(schema: any): any {
	if (!schema || typeof schema !== 'object') {
		return schema;
	}

	if (Array.isArray(schema)) {
		return schema.map(item => simplifyToolSchema(item));
	}

	// biome-ignore lint/suspicious/noExplicitAny: Final schema object build
	const result: any = {};
	for (const key of Object.keys(schema)) {
		// Skip description and example fields
		if (key === 'description' || key === 'example' || key === 'examples') {
			continue;
		}
		result[key] = simplifyToolSchema(schema[key]);
	}
	return result;
}

export interface ChatHandlerParams {
	model: LanguageModel;
	currentModel: string;
	providerConfig: AIProviderConfig;
	messages: Message[];
	tools: Record<string, AISDKCoreTool>;
	callbacks: StreamCallbacks;
	signal?: AbortSignal;
	maxRetries: number;
	skipTools?: boolean; // Track if we're retrying without tools
	modeOverrides?: ModeOverrides;
}

/**
 * Main chat handler - orchestrates the entire chat flow
 */
export async function handleChat(
	params: ChatHandlerParams,
): Promise<LLMChatResponse> {
	const {
		model,
		currentModel,
		providerConfig,
		messages,
		tools,
		callbacks,
		signal,
		maxRetries,
		skipTools = false,
		modeOverrides,
	} = params;
	const logger = getLogger();

	// Check if already aborted before starting
	if (signal?.aborted) {
		logger.debug('Chat request already aborted');
		throw new Error('Operation was cancelled');
	}

	// Check if tools should be disabled
	const shouldDisableTools =
		skipTools ||
		providerConfig.disableTools ||
		(providerConfig.disableToolModels &&
			providerConfig.disableToolModels.includes(currentModel));

	// Start performance tracking
	const metrics = startMetrics();
	const correlationId = getCorrelationId() || generateCorrelationId();

	if (shouldDisableTools) {
		logger.info('Tools disabled for request', {
			model: currentModel,
			reason: skipTools
				? 'retry without tools'
				: providerConfig.disableTools
					? 'provider configuration'
					: 'model configuration',
			correlationId,
		});
	}

	logger.info('Chat request starting', {
		model: currentModel,
		messageCount: messages.length,
		toolCount: shouldDisableTools ? 0 : Object.keys(tools).length,
		correlationId,
		provider: providerConfig.name,
	});

	return await withNewCorrelationContext(async _context => {
		try {
			// Apply non-interactive mode overrides to tool approval
			// In non-interactive mode, tools in the allowList should bypass needsApproval
			let effectiveTools = tools;
			if (
				modeOverrides?.nonInteractiveMode &&
				modeOverrides.nonInteractiveAlwaysAllow.length > 0
			) {
				const allowSet = new Set(modeOverrides.nonInteractiveAlwaysAllow);
				effectiveTools = Object.fromEntries(
					Object.entries(tools).map(([name, toolDef]) => {
						if (allowSet.has(name)) {
							// Override needsApproval to false for allowed tools
							return [
								name,
								{...toolDef, needsApproval: false} as AISDKCoreTool,
							];
						}
						return [name, toolDef];
					}),
				);
			}

			// Apply schema simplification if enabled
			const smmConfig = providerConfig.smallModelMode;
			if (smmConfig?.enabled && smmConfig.simplifiedSchemas) {
				effectiveTools = Object.fromEntries(
					Object.entries(effectiveTools).map(([name, toolDef]) => {
						// biome-ignore lint/suspicious/noExplicitAny: Cast to access inputSchema which is an internal AI SDK type often nested deeply
						const toolAny = toolDef as any;
						return [
							name,
							{
								...toolDef,
								inputSchema: simplifyToolSchema(toolAny.inputSchema),
							} as AISDKCoreTool,
						];
					}),
				);
				logger.debug('Simplified tool schemas for small model mode', {
					correlationId,
				});
			}

			// Tools are already in AI SDK format - use directly
			const aiTools = shouldDisableTools
				? undefined
				: Object.keys(effectiveTools).length > 0
					? effectiveTools
					: undefined;

			// When native tools are disabled but we have tools, inject definitions into system prompt
			// This allows the model to still use tools via XML format
			let messagesWithToolPrompt = messages;
			if (shouldDisableTools && Object.keys(tools).length > 0) {
				const toolPrompt = formatToolsForPrompt(tools);
				if (toolPrompt) {
					// Find and augment the system message with tool definitions
					messagesWithToolPrompt = messages.map((msg, index) => {
						if (msg.role === 'system' && index === 0) {
							return {
								...msg,
								content: msg.content + toolPrompt,
							};
						}
						return msg;
					});

					logger.debug('Injected tool definitions into system prompt', {
						toolCount: Object.keys(tools).length,
						promptLength: toolPrompt.length,
					});
				}
			}

			// Convert messages to AI SDK v5 ModelMessage format
			const modelMessages = convertToModelMessages(messagesWithToolPrompt);

			logger.debug('AI SDK request prepared', {
				messageCount: modelMessages.length,
				hasTools: !!aiTools,
				toolCount: aiTools ? Object.keys(aiTools).length : 0,
			});

			// Tools with needsApproval: false auto-execute in the SDK's loop
			// Tools with needsApproval: true cause the SDK to stop for approval
			// stopWhen controls when the tool loop stops (max MAX_TOOL_STEPS steps)
			const result = await generateText({
				model,
				messages: modelMessages,
				tools: aiTools,
				abortSignal: signal,
				maxRetries,
				stopWhen: stepCountIs(MAX_TOOL_STEPS),
				onStepFinish: createOnStepFinishHandler(callbacks),
				prepareStep: createPrepareStepHandler(),
				headers: providerConfig.config.headers,
			});

			const fullText = result.text;

			logger.debug('AI SDK response received', {
				responseLength: fullText.length,
				hasToolCalls: result.toolCalls.length > 0,
				toolCallCount: result.toolCalls.length,
				stepCount: result.steps.length,
			});

			// Send the complete text to the callback
			if (fullText) {
				callbacks.onToken?.(fullText);
			}

			// Without execute functions on tools, the SDK doesn't auto-execute anything.
			// All tool calls are returned for us to handle (parallel execution, confirmation, etc.).
			const toolCalls: ToolCall[] =
				result.toolCalls.length > 0
					? convertAISDKToolCalls(result.toolCalls)
					: [];

			const content = fullText;

			// Calculate performance metrics
			const finalMetrics = endMetrics(metrics);

			logger.info('Chat request completed successfully', {
				model: currentModel,
				duration: `${finalMetrics.duration.toFixed(2)}ms`,
				responseLength: content.length,
				toolCallsFound: toolCalls.length,
				memoryDelta: formatMemoryUsage(
					finalMetrics.memoryUsage || getSafeMemory(),
				),
				correlationId,
				provider: providerConfig.name,
			});

			callbacks.onFinish?.();

			return {
				choices: [
					{
						message: {
							role: 'assistant',
							content,
							tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
						},
					},
				],
				toolsDisabled: shouldDisableTools,
			};
		} catch (error) {
			// Calculate performance metrics even for errors
			const finalMetrics = endMetrics(metrics);

			// Check if this was a user-initiated cancellation
			if (error instanceof Error && error.name === 'AbortError') {
				logger.info('Chat request cancelled by user', {
					model: currentModel,
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					correlationId,
					provider: providerConfig.name,
				});
				throw new Error('Operation was cancelled');
			}

			// Check if error indicates tool support issue and we haven't retried
			if (!skipTools && isToolSupportError(error)) {
				const smmConfig = providerConfig.smallModelMode;

				// Case 1: Already in SMM, but hit a tool error.
				// Enable aggressive simplification and slim prompt for the retry.
				if (smmConfig?.enabled) {
					logger.warn(
						'Tool support error in Small Model Mode, retrying with maximized simplification',
						{
							model: currentModel,
							correlationId,
						},
					);

					const maxSimpConfig = {
						...providerConfig,
						smallModelMode: {
							...smmConfig,
							simplifiedSchemas: true,
							slimPrompt: true,
							// If minimal profile isn't already active, maybe try it?
							// For now just stick to maximizing simplification.
						},
					};

					return await handleChat({
						...params,
						providerConfig: maxSimpConfig,
						skipTools: true, // This currently disables native tools entirely.
						// Wait, skipTools=true in handleChat makes it use XML for ALL tools.
						// That might actually be better for small models failing native tools.
					});
				}

				// Case 2: Not in SMM. Enable it for the retry.
				logger.warn(
					'Tool support error detected, retrying with Small Model Mode enabled',
					{
						model: currentModel,
						error: error instanceof Error ? error.message : error,
						correlationId,
						provider: providerConfig.name,
					},
				);

				const smmRetryConfig = {
					...providerConfig,
					smallModelMode: {
						enabled: true,
						simplifiedSchemas: true,
						slimPrompt: true,
					},
				};

				return await handleChat({
					...params,
					providerConfig: smmRetryConfig,
					skipTools: true, // Use XML fallback for retry
				});
			}

			// Handle tool-specific errors - NoSuchToolError
			if (error instanceof NoSuchToolError) {
				logger.error('Tool not found', {
					toolName: error.toolName,
					model: currentModel,
					correlationId,
					provider: providerConfig.name,
				});

				// Provide helpful error message with available tools
				const availableTools = Object.keys(tools).join(', ');
				const errorMessage = availableTools
					? `Tool "${error.toolName}" does not exist. Available tools: ${availableTools}`
					: `Tool "${error.toolName}" does not exist and no tools are currently loaded.`;

				throw new Error(errorMessage);
			}

			// Handle tool-specific errors - InvalidToolInputError
			if (error instanceof InvalidToolInputError) {
				logger.error('Invalid tool input', {
					toolName: error.toolName,
					model: currentModel,
					correlationId,
					provider: providerConfig.name,
					validationError: error.message,
				});

				// Provide clear validation error
				throw new Error(
					`Invalid arguments for tool "${error.toolName}": ${error.message}`,
				);
			}

			// Handle tool-specific errors - ToolCallRepairError
			if (error instanceof ToolCallRepairError) {
				logger.error('Tool call repair failed', {
					toolName: error.originalError.toolName,
					model: currentModel,
					correlationId,
					provider: providerConfig.name,
					repairError: error.message,
				});

				// Fall through to general error handling
				// Don't throw here - let the general handler provide context
			}

			// Log the error with performance metrics
			logger.error('Chat request failed', {
				model: currentModel,
				duration: `${finalMetrics.duration.toFixed(2)}ms`,
				error: error instanceof Error ? error.message : error,
				errorName: error instanceof Error ? error.name : 'Unknown',
				errorType: error?.constructor?.name || 'Unknown',
				correlationId,
				provider: providerConfig.name,
				memoryDelta: formatMemoryUsage(
					finalMetrics.memoryUsage || getSafeMemory(),
				),
			});

			// AI SDK wraps errors in NoOutputGeneratedError with no useful cause
			// Check if it's a cancellation without an underlying API error
			if (
				error instanceof Error &&
				(error.name === 'AI_NoOutputGeneratedError' ||
					error.message.includes('No output generated'))
			) {
				// Check if there's an underlying RetryError with the real cause
				const rootError = extractRootError(error);
				if (rootError === error) {
					// No underlying error - check if user actually cancelled
					if (signal?.aborted) {
						throw new Error('Operation was cancelled');
					}
					// Model returned empty response without cancellation
					throw new Error(
						'Model returned empty response. This may indicate the model is not responding correctly or the prompt was unclear.',
					);
				}
				// There's a real error underneath, parse it
				const userMessage = parseAPIError(rootError);
				throw new Error(userMessage);
			}

			// Parse any other error (including RetryError and APICallError)
			const userMessage = parseAPIError(error);
			throw new Error(userMessage);
		}
	}, correlationId); // End of withNewCorrelationContext
}
