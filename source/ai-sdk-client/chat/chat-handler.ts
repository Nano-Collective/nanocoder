import type {LanguageModel} from 'ai';
import {
	InvalidToolInputError,
	NoSuchToolError,
	stepCountIs,
	streamText,
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
	generateCorrelationId,
	getCorrelationId,
	getLogger,
	withNewCorrelationContext,
} from '@/utils/logging';
import {
	endMetrics,
	formatMemoryUsage,
	startMetrics,
} from '@/utils/logging/performance.js';
import {getSafeMemory} from '@/utils/logging/safe-process.js';
import {convertToModelMessages} from '../converters/message-converter.js';
import {convertAISDKToolCalls} from '../converters/tool-converter.js';
import {extractRootError} from '../error-handling/error-extractor.js';
import {parseAPIError} from '../error-handling/error-parser.js';
import {isToolSupportError} from '../error-handling/tool-error-detector.js';
import {
	createOnStepFinishHandler,
	createPrepareStepHandler,
} from './streaming-handler.js';

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
			// Tools arrive with approval policy already resolved by ToolManager.
			// No approval mutation needed here — chat handler is a pure SDK caller.
			const aiTools = shouldDisableTools
				? undefined
				: Object.keys(tools).length > 0
					? tools
					: undefined;

			// XML tool definitions are already included in the system prompt
			// when native tools are disabled (handled upstream in useChatHandler).

			// Convert messages to AI SDK v5 ModelMessage format
			const modelMessages = convertToModelMessages(messages);

			logger.debug('AI SDK request prepared', {
				messageCount: modelMessages.length,
				hasTools: !!aiTools,
				toolCount: aiTools ? Object.keys(aiTools).length : 0,
			});

			// Tools with needsApproval: false auto-execute in the SDK's loop
			// Tools with needsApproval: true cause the SDK to stop for approval
			// stopWhen controls when the tool loop stops (max MAX_TOOL_STEPS steps)

			// ChatGPT/Codex backend requires the system message as a top-level
			// `instructions` field rather than as an input item. Extract it and
			// pass via providerOptions so the Responses API includes it.
			let providerOptions:
				| Record<string, Record<string, string | boolean>>
				| undefined;
			if (providerConfig.sdkProvider === 'chatgpt-codex') {
				const systemMsg = messages.find(m => m.role === 'system');
				providerOptions = {
					openai: {
						...(systemMsg ? {instructions: systemMsg.content} : {}),
						store: false,
					},
				};
			}

			const result = streamText({
				model,
				messages: modelMessages,
				tools: aiTools,
				abortSignal: signal,
				maxRetries,
				stopWhen: stepCountIs(MAX_TOOL_STEPS),
				onStepFinish: createOnStepFinishHandler(callbacks),
				prepareStep: createPrepareStepHandler(),
				onError: ({error}) => {
					// Catch streaming errors so raw SSE events don't leak to stdout.
					// The error will still be thrown by the stream and caught by
					// the outer try-catch for proper formatting.
					logger.warn('Streaming error received', {
						error: error instanceof Error ? error.message : String(error),
						model: currentModel,
						correlationId,
						provider: providerConfig.name,
					});
				},
				headers: providerConfig.config.headers,
				providerOptions,
				// Model parameters from /tune — passed directly to AI SDK
				...(modeOverrides?.modelParameters && {
					temperature: modeOverrides.modelParameters.temperature,
					topP: modeOverrides.modelParameters.topP,
					topK: modeOverrides.modelParameters.topK,
					maxTokens: modeOverrides.modelParameters.maxTokens,
					frequencyPenalty: modeOverrides.modelParameters.frequencyPenalty,
					presencePenalty: modeOverrides.modelParameters.presencePenalty,
					...(modeOverrides.modelParameters.stop && {
						stopSequences: modeOverrides.modelParameters.stop,
					}),
				}),
			});

			// Stream tokens to the UI in batched chunks to avoid excessive
			// React/Ink re-renders that cause terminal flickering.
			const FLUSH_INTERVAL_MS = 150;
			let tokenBuffer = '';
			let flushTimer: ReturnType<typeof setTimeout> | null = null;

			const flushBuffer = () => {
				if (tokenBuffer) {
					callbacks.onToken?.(tokenBuffer);
					tokenBuffer = '';
				}
				flushTimer = null;
			};

			let lastYield = Date.now();
			for await (const chunk of result.textStream) {
				if (chunk) {
					tokenBuffer += chunk;
					if (!flushTimer) {
						flushTimer = setTimeout(flushBuffer, FLUSH_INTERVAL_MS);
					}
				}
				// Periodically yield to the event loop so timers and Ink renders
				// can run during long streaming responses (e.g. subagent execution)
				const now = Date.now();
				if (now - lastYield >= 200) {
					lastYield = now;
					await new Promise<void>(resolve => setTimeout(resolve, 0));
				}
			}

			// Flush any remaining tokens
			if (flushTimer) {
				clearTimeout(flushTimer);
			}
			flushBuffer();

			// After streaming completes, collect final results
			const [fullText, resolvedToolCalls, resolvedSteps] = await Promise.all([
				result.text,
				result.toolCalls,
				result.steps,
			]);

			logger.debug('AI SDK response received', {
				responseLength: fullText.length,
				hasToolCalls: resolvedToolCalls.length > 0,
				toolCallCount: resolvedToolCalls.length,
				stepCount: resolvedSteps.length,
			});

			// Without execute functions on tools, the SDK doesn't auto-execute anything.
			// All tool calls are returned for us to handle (parallel execution, confirmation, etc.).
			const toolCalls: ToolCall[] =
				resolvedToolCalls.length > 0
					? convertAISDKToolCalls(resolvedToolCalls)
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
