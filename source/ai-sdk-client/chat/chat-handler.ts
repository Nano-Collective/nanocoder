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
import {convertToModelMessages} from '../converters/message-converter.js';
import {
	convertAISDKToolCalls,
	generateToolCallId,
	getToolResultOutput,
} from '../converters/tool-converter.js';
import {extractRootError} from '../error-handling/error-extractor.js';
import {parseAPIError} from '../error-handling/error-parser.js';
import {isToolSupportError} from '../error-handling/tool-error-detector.js';
import {formatToolsForPrompt} from '../tools/tool-prompt-formatter.js';
import {
	createOnStepFinishHandler,
	createPrepareStepHandler,
} from './streaming-handler.js';
import {processXMLToolCalls} from './tool-processor.js';

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
			// Tools are already in AI SDK format - use directly
			const aiTools = shouldDisableTools
				? undefined
				: Object.keys(tools).length > 0
					? tools
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

			// Tools with needsApproval: false auto-execute in the loop
			// Tools with needsApproval: true cause interruptions for manual approval
			// stopWhen controls when the tool loop stops (max MAX_TOOL_STEPS steps)
			const result = await generateText({
				model,
				messages: modelMessages,
				tools: aiTools,
				abortSignal: signal,
				maxRetries,
				stopWhen: stepCountIs(MAX_TOOL_STEPS), // Allow up to MAX_TOOL_STEPS tool execution steps
				// Can be used to add custom logging, metrics, or step tracking
				onStepFinish: createOnStepFinishHandler(callbacks),
				prepareStep: createPrepareStepHandler(),
				headers: providerConfig.config.headers,
			});

			// Get the full text from the result
			const fullText = result.text;

			logger.debug('AI SDK response received', {
				responseLength: fullText.length,
				hasToolCalls: !!(result.toolCalls && result.toolCalls.length > 0),
				toolCallCount: result.toolCalls?.length || 0,
			});

			// Send the complete text to the callback
			if (fullText) {
				callbacks.onToken?.(fullText);
			}

			// Get tool calls from result
			const toolCallsResult = result.toolCalls;

			// Extract auto-executed assistant messages and tool results from steps
			// These need to be added to the messages array so usage tracking can count them
			const autoExecutedMessages: Array<Message> = [];
			const steps = result.steps;
			for (const step of steps) {
				if (
					step.toolCalls &&
					step.toolResults &&
					step.toolCalls.length === step.toolResults.length
				) {
					// This step had tool calls that were auto-executed
					// Add the assistant message with tool_calls
					const stepToolCalls: ToolCall[] = convertAISDKToolCalls(
						step.toolCalls,
					);

					autoExecutedMessages.push({
						role: 'assistant',
						content: step.text || '',
						tool_calls: stepToolCalls,
					});

					// Add the tool result messages
					step.toolCalls.forEach((toolCall, idx) => {
						const toolResult = step.toolResults[idx];
						const resultStr = getToolResultOutput(toolResult.output);

						autoExecutedMessages.push({
							role: 'tool' as const,
							content: resultStr,
							tool_call_id: toolCall.toolCallId || generateToolCallId(),
							name: toolCall.toolName,
						});
					});
				}
			}

			// Extract tool calls
			const toolCalls: ToolCall[] = [];
			if (toolCallsResult && toolCallsResult.length > 0) {
				logger.debug('Processing tool calls from response', {
					toolCallCount: toolCallsResult.length,
				});

				for (const toolCall of toolCallsResult) {
					const tc: ToolCall = convertAISDKToolCalls([toolCall])[0];
					toolCalls.push(tc);

					logger.debug('Tool call processed', {
						toolName: tc.function.name,
						hasArguments: !!tc.function.arguments,
					});

					// Note: onToolCall already fired in onStepFinish - no need to call again
				}
			}

			// Check for XML tool calls if no native ones
			let content = fullText;
			const xmlResult = await processXMLToolCalls(content, tools, callbacks);
			if (xmlResult.toolCalls.length > 0) {
				toolCalls.push(...xmlResult.toolCalls);
				content = xmlResult.cleanedContent;
			}

			// Calculate performance metrics
			const finalMetrics = endMetrics(metrics);

			logger.info('Chat request completed successfully', {
				model: currentModel,
				duration: `${finalMetrics.duration.toFixed(2)}ms`,
				responseLength: content.length,
				toolCallsFound: toolCalls.length,
				memoryDelta: formatMemoryUsage(
					finalMetrics.memoryUsage || process.memoryUsage(),
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
				// Include auto-executed messages so they can be added to message history
				autoExecutedMessages:
					autoExecutedMessages.length > 0 ? autoExecutedMessages : undefined,
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
				logger.warn('Tool support error detected, retrying without tools', {
					model: currentModel,
					error: error instanceof Error ? error.message : error,
					correlationId,
					provider: providerConfig.name,
				});

				// Retry without tools
				return await handleChat({
					...params,
					skipTools: true, // Mark that we're retrying
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
					finalMetrics.memoryUsage || process.memoryUsage(),
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
