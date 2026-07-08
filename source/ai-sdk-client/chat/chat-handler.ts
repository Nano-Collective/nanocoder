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
import {buildProviderOptions} from './provider-options.js';
import {
	createOnStepFinishHandler,
	createPrepareStepHandler,
} from './streaming-handler.js';

type SDKProviderOptions = Parameters<typeof streamText>[0]['providerOptions'];

export interface ChatHandlerParams {
	model: LanguageModel;
	currentModel: string;
	providerConfig: AIProviderConfig;
	messages: Message[];
	tools: Record<string, AISDKCoreTool>;
	callbacks: StreamCallbacks;
	signal?: AbortSignal;
	maxRetries: number;
	skipTools?: boolean;
	modeOverrides?: ModeOverrides;
	privacySessionMapRef?: React.MutableRefObject<Record<string, string>>;
	privacyEnabled?: boolean;
	onPrivacyEvent?: (scrubbedDelta: number) => void;
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
		privacySessionMapRef,
		privacyEnabled,
		onPrivacyEvent,
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

	// Accumulate reasoning text outside the try so the catch handler can
	// include it on the empty-response branch — the conversation loop's
	// reasoning-aware nudge depends on this for the GPT-5 case where the
	// SDK throws AI_NoOutputGeneratedError after a reasoning-only stream.
	let accumulatedReasoning = '';
	let accumulatedText = '';

	// Hoisted outside the try so the catch handler can inspect errors the SDK
	// reported via streamText's onError callback. A connectivity failure is
	// surfaced here AND then re-thrown by the SDK as AI_NoOutputGeneratedError
	// with no `cause`; without consulting this array the catch can't tell a
	// network failure apart from a genuine empty model turn.
	const streamingErrors: Error[] = [];

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

			// AI SDK v6 wants the system prompt via the top-level `system` option
			// rather than as a system-role entry in `messages` (it warns otherwise
			// to discourage prompt-injection-prone patterns). Extract it here.
			const systemContent = messages
				.filter(m => m.role === 'system')
				.map(m => m.content)
				.join('\n\n');
			const nonSystemMessages = messages.filter(m => m.role !== 'system');

			// Scrub prompts if privacy scrubbing is enabled
			let finalSystemContent = systemContent;
			let finalNonSystemMessages = nonSystemMessages;
			if (privacyEnabled && privacySessionMapRef) {
				const {scrub} = await import('@nanocollective/prompt-scrub');

				const prevCount = Object.keys(privacySessionMapRef.current).length;

				finalSystemContent = scrub({
					content: systemContent,
					sessionMap: privacySessionMapRef.current,
					options: {disabledDetectors: ['PathDetector', 'UrlDetector']},
				}).scrubbedContent as string;

				finalNonSystemMessages = nonSystemMessages.map(m => {
					if (m.role === 'tool') return m;
					return {
						...m,
						content: scrub({
							content: m.content,
							sessionMap: privacySessionMapRef.current,
							options: {disabledDetectors: ['PathDetector', 'UrlDetector']},
						}).scrubbedContent as string,
					};
				});

				const newCount = Object.keys(privacySessionMapRef.current).length;
				const delta = newCount - prevCount;
				if (delta > 0 && onPrivacyEvent) {
					onPrivacyEvent(delta);
				}
			}

			// Convert messages to AI SDK v5 ModelMessage format
			const modelMessages = convertToModelMessages(finalNonSystemMessages);

			logger.debug('AI SDK request prepared', {
				messageCount: modelMessages.length,
				hasSystem: systemContent.length > 0,
				hasTools: !!aiTools,
				toolCount: aiTools ? Object.keys(aiTools).length : 0,
			});

			// These tools have `execute` stripped, so the SDK never auto-runs
			// them - it emits the tool call and stops, and our loop decides
			// approval/execution (see resolveToolApproval).
			// stopWhen controls when the tool loop stops (max MAX_TOOL_STEPS steps)

			// Provider-specific request extras (Codex Responses API fields,
			// OpenRouter provider routing / reasoning / transforms / fallback
			// models). buildProviderOptions returns undefined when nothing
			// applies, so the SDK call site doesn't see an empty object.
			const providerOptions = buildProviderOptions(
				providerConfig,
				systemContent,
				modeOverrides?.modelParameters,
			);

			const result = streamText({
				model,
				...(finalSystemContent ? {system: finalSystemContent} : {}),
				messages: modelMessages,
				tools: aiTools,
				abortSignal: signal,
				maxRetries,
				stopWhen: stepCountIs(MAX_TOOL_STEPS),
				onStepFinish: createOnStepFinishHandler(callbacks),
				prepareStep: createPrepareStepHandler(),
				onError: ({error}) => {
					// Collect streaming errors so raw SSE events don't leak to stdout.
					// AI SDK delivers plain objects here for some providers (e.g.
					// OpenRouter stream errors), so String() would yield "[object Object]".
					let e: Error;
					if (error instanceof Error) {
						e = error;
					} else if (typeof error === 'string') {
						e = new Error(error);
					} else {
						try {
							e = new Error(JSON.stringify(error));
						} catch {
							e = new Error(String(error));
						}
					}
					streamingErrors.push(e);
					logger.warn('Streaming error received', {
						error: e.message,
						model: currentModel,
						correlationId,
						provider: providerConfig.name,
					});
				},
				headers: providerConfig.config.headers,
				// Cast to the SDK's narrower JSON-only type. The values built by
				// buildProviderOptions are all JSON-serialisable, but TypeScript
				// can't infer that through our looser internal shape.
				providerOptions: providerOptions as SDKProviderOptions,
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
			let isReasoning = false;

			const flushBuffer = () => {
				if (tokenBuffer) {
					if (isReasoning) {
						callbacks.onReasoningToken?.(tokenBuffer);
					} else {
						callbacks.onToken?.(tokenBuffer);
					}
					tokenBuffer = '';
				}
				flushTimer = null;
			};

			let lastYield = Date.now();
			for await (const chunk of result.fullStream) {
				switch (chunk.type) {
					case 'reasoning-delta':
						accumulatedReasoning += chunk.text;
						tokenBuffer += chunk.text;
						if (!flushTimer) {
							flushTimer = setTimeout(flushBuffer, FLUSH_INTERVAL_MS);
						}
						break;
					case 'text-delta':
						accumulatedText += chunk.text;
						tokenBuffer += chunk.text;
						if (!flushTimer) {
							flushTimer = setTimeout(flushBuffer, FLUSH_INTERVAL_MS);
						}
						break;

					// Determine which stream to write tokens to
					case 'reasoning-start':
						isReasoning = true;
						break;
					case 'text-start':
						isReasoning = false;
						break;

					// Flush remaining tokens in given stream
					case 'text-end':
					case 'reasoning-end':
						if (flushTimer) {
							clearTimeout(flushTimer);
						}
						flushBuffer();
						isReasoning = false;
						break;
				}
				// Periodically yield to the event loop so timers and Ink renders
				// can run during long streaming responses (e.g. subagent execution)
				const now = Date.now();
				if (now - lastYield >= 200) {
					lastYield = now;
					await new Promise<void>(resolve => setTimeout(resolve, 0));
				}
			}

			// Safety net: flush any tokens still buffered if the stream ended
			// without emitting a matching text-end / reasoning-end event.
			if (flushTimer) {
				clearTimeout(flushTimer);
			}
			flushBuffer();

			// After streaming completes, collect final results.
			// `result.usage` is the FINAL step's usage (not `totalUsage`, which
			// sums across steps): with stopWhen=stepCountIs(MAX_TOOL_STEPS) a
			// single chat() call may span multiple steps, and the final step's
			// input+output tokens reflect the actual context window occupancy.
			const [
				fullText,
				resolvedToolCalls,
				resolvedSteps,
				reasoning,
				finishReason,
				usage,
			] = await Promise.all([
				result.text,
				result.toolCalls,
				result.steps,
				result.reasoningText,
				result.finishReason,
				result.usage,
			]);

			logger.debug('AI SDK response received', {
				responseLength: fullText.length,
				reasoningLength: reasoning?.length ?? 0,
				hasToolCalls: resolvedToolCalls.length > 0,
				toolCallCount: resolvedToolCalls.length,
				stepCount: resolvedSteps.length,
				finishReason,
			});

			if (finishReason === 'error' && streamingErrors.length > 0) {
				throw streamingErrors[streamingErrors.length - 1];
			}

			// Without execute functions on tools, the SDK doesn't auto-execute anything.
			// All tool calls are returned for us to handle (parallel execution, confirmation, etc.).
			const toolCalls: ToolCall[] =
				resolvedToolCalls.length > 0
					? convertAISDKToolCalls(resolvedToolCalls)
					: [];

			const content = fullText || accumulatedText;

			let finalContent = content;
			let finalReasoning = reasoning;
			let finalToolCalls = toolCalls;

			if (privacyEnabled && privacySessionMapRef) {
				const {rehydrate} = await import('@nanocollective/prompt-scrub');

				if (finalContent) {
					const result = rehydrate({
						content: finalContent,
						sessionMap: privacySessionMapRef.current,
					});
					finalContent = result.content as string;
					if (result.warnings && result.warnings.length > 0) {
						logger.warn('Prompt-scrub rehydration warnings (content)', {
							warnings: result.warnings,
						});
					}
				}

				if (finalReasoning) {
					const result = rehydrate({
						content: finalReasoning,
						sessionMap: privacySessionMapRef.current,
					});
					finalReasoning = result.content as string;
					if (result.warnings && result.warnings.length > 0) {
						logger.warn('Prompt-scrub rehydration warnings (reasoning)', {
							warnings: result.warnings,
						});
					}
				}

				if (finalToolCalls.length > 0) {
					finalToolCalls = finalToolCalls.map(tc => {
						try {
							const argsStr = JSON.stringify(tc.function.arguments);
							const result = rehydrate({
								content: argsStr,
								sessionMap: privacySessionMapRef.current,
							});
							if (result.warnings && result.warnings.length > 0) {
								logger.warn('Prompt-scrub rehydration warnings (tool args)', {
									toolName: tc.function.name,
									warnings: result.warnings,
								});
							}
							return {
								...tc,
								function: {
									...tc.function,
									arguments: JSON.parse(result.content as string),
								},
							};
						} catch (e) {
							logger.error('Failed to rehydrate tool call', {
								toolName: tc.function.name,
								error: e,
							});
							return tc;
						}
					});
				}
			}

			// Calculate performance metrics
			const finalMetrics = endMetrics(metrics);

			logger.info('Chat request completed successfully', {
				model: currentModel,
				duration: `${finalMetrics.duration.toFixed(2)}ms`,
				responseLength: content.length,
				reasoningLength: reasoning?.length ?? 0,
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
							content: finalContent,
							tool_calls:
								finalToolCalls.length > 0 ? finalToolCalls : undefined,
							reasoning: finalReasoning,
						},
					},
				],
				toolsDisabled: shouldDisableTools,
				usage: {
					inputTokens: usage.inputTokens,
					outputTokens: usage.outputTokens,
					totalTokens: usage.totalTokens,
				},
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
				errorProps:
					error instanceof Error
						? Object.fromEntries(
								Object.getOwnPropertyNames(error)
									.filter(k => k !== 'stack')
									// biome-ignore lint/suspicious/noExplicitAny: dynamic error shape
									.map(k => [k, (error as any)[k]]),
							)
						: undefined,
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
					// The SDK frequently re-throws transport failures (no internet,
					// DNS/connection errors) as AI_NoOutputGeneratedError WITHOUT a
					// `cause`, so extractRootError can't recover them. But streamText's
					// onError callback already captured the real error here. Surface it
					// instead of returning an empty turn, otherwise the conversation
					// loop mistakes the network failure for context exhaustion and
					// prints a misleading "Context too large" auto-compact message.
					if (streamingErrors.length > 0) {
						const userMessage = parseAPIError(
							streamingErrors[streamingErrors.length - 1],
						);
						throw new Error(userMessage);
					}
					// Model returned no output without an underlying API error.
					// Hand control back to the conversation loop with an empty
					// response so its empty-turn handling (capped recursion,
					// reasoning-aware nudge) takes over instead of throwing.
					logger.warn(
						'Model produced no output; returning streamed fallback response',
						{
							model: currentModel,
							correlationId,
							provider: providerConfig.name,
							responseLength: accumulatedText.length,
							reasoningLength: accumulatedReasoning.length,
						},
					);
					callbacks.onFinish?.();
					return {
						choices: [
							{
								message: {
									role: 'assistant',
									content: accumulatedText,
									reasoning: accumulatedReasoning || undefined,
								},
							},
						],
						toolsDisabled: shouldDisableTools,
					};
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
