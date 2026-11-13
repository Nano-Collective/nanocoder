import {APICallError} from 'ai';
import {extractRootError} from '@/ai-sdk-client/error-handling/error-extractor';
import type {
	AISDKCoreTool,
	LLMChatResponse,
	LLMClient,
	Message,
	ModeOverrides,
	StreamCallbacks,
} from '@/types/index';
import {getLogger} from '@/utils/logging';

/**
 * Provider fallback: when the primary provider fails a request with a
 * retryable error (429, 5xx, network) after exhausting its own `maxRetries`,
 * the conversation loop re-sends the same request to the next entry of the
 * primary's `fallback` list. The first fallback that answers serves the
 * turn; the primary stays selected for the next turn.
 *
 * This lives in the client factory, not in `AISDKClient`, so every frontend
 * (TUI, --plain, ACP, subagents) gets it from `createLLMClient` with no
 * per-frontend wiring, and so the loop can be unit-tested with fake
 * `LLMClient`s instead of a live model.
 */

/** One parsed `fallback` entry: a provider name, optionally `provider/model`. */
export interface FallbackTarget {
	provider: string;
	model?: string;
}

export function parseFallbackEntry(entry: string): FallbackTarget | null {
	const trimmed = entry.trim();
	if (!trimmed) return null;
	const slash = trimmed.indexOf('/');
	if (slash === -1) return {provider: trimmed};
	const provider = trimmed.slice(0, slash).trim();
	const model = trimmed.slice(slash + 1).trim();
	if (!provider || !model) return null;
	return {provider, model};
}

/**
 * Whether a request failure may be retried against a fallback provider.
 *
 * Retryable: 429, 5xx, network/transport failures, timeouts — the same class
 * the AI SDK retries internally via `maxRetries`, which is already exhausted
 * by the time the error reaches here. Non-retryable: auth (401/403),
 * invalid request (400), model not found (404), context-length errors, user
 * cancellation, and tool errors. Those fail the turn as before.
 *
 * The error arriving here is usually the user-facing string `handleChat`
 * produces via `parseAPIError`, so classification matches those messages as
 * well as the raw `APICallError` / network error underneath.
 */
const RETRYABLE_MESSAGE_PREFIXES = [
	'Rate limit', // 429
	'Server error:', // 500/502/503
	'Connection failed:', // ECONNREFUSED, ENOTFOUND, ECONNRESET, DNS, fetch failed
	'Request timed out', // ETIMEDOUT, headers timeout
];

const RETRYABLE_MESSAGE_PATTERNS = [
	/Request failed \((?:429|5\d\d)\)/, // 429 or any 5xx via the default branch
	/429/,
	/\b5\d\d\b/,
	/ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN/,
	/fetch failed|failed to fetch|network error/i,
];

const NON_RETRYABLE_MESSAGE_PREFIXES = [
	'Authentication failed:',
	'Access forbidden:',
	'Bad request:',
	'Model not found:',
	'Context too large:',
	'Too many tokens:',
	'Invalid provider URL',
	'Operation was cancelled',
];

export function isRetryableProviderError(error: unknown): boolean {
	const rootError = extractRootError(error);

	if (APICallError.isInstance(rootError)) {
		const statusCode = rootError.statusCode;
		if (statusCode !== undefined) {
			return statusCode === 429 || statusCode >= 500;
		}
	}

	const message =
		rootError instanceof Error ? rootError.message : String(rootError);

	for (const prefix of NON_RETRYABLE_MESSAGE_PREFIXES) {
		if (message.startsWith(prefix)) return false;
	}
	for (const prefix of RETRYABLE_MESSAGE_PREFIXES) {
		if (message.startsWith(prefix)) return true;
	}
	for (const pattern of RETRYABLE_MESSAGE_PATTERNS) {
		if (pattern.test(message)) return true;
	}
	return false;
}

/** One-line notice naming the provider that answered the turn. */
export function buildFallbackNotice(
	primaryName: string,
	fallback: FallbackTarget,
): string {
	const answeredBy = fallback.model
		? `"${fallback.provider}" (${fallback.model})`
		: `"${fallback.provider}"`;
	return (
		`Provider "${primaryName}" failed; answered by fallback ${answeredBy}. ` +
		`"${primaryName}" stays selected for the next turn.`
	);
}

/** Builds a fallback client for one entry: `(provider, model?) => client`. */
export type FallbackClientFactory = (
	provider: string,
	model?: string,
) => Promise<LLMClient>;

/**
 * An `LLMClient` that tries the primary first and, only on a retryable
 * error, re-sends the same request to each configured fallback in order.
 * The primary client is never replaced: every `chat()` call starts from it
 * again, so the next turn still uses the primary.
 */
export class FallbackLLMClient implements LLMClient {
	private readonly primaryName: string;
	private readonly targets: FallbackTarget[];

	constructor(
		private readonly primary: LLMClient,
		fallbackEntries: string[],
		private readonly createFallbackClient: FallbackClientFactory,
	) {
		this.primaryName = primary.getProviderConfig().name;
		const seen = new Set([this.primaryName.toLowerCase()]);
		this.targets = [];
		for (const entry of fallbackEntries) {
			const parsed = parseFallbackEntry(entry);
			if (!parsed) continue;
			// A fallback naming the primary (or a duplicate) would just repeat
			// the request that already failed after its retries.
			const key = parsed.provider.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			this.targets.push(parsed);
		}
	}

	getCurrentModel(): string {
		return this.primary.getCurrentModel();
	}

	setModel(model: string): void {
		this.primary.setModel(model);
	}

	getContextSize(): number {
		return this.primary.getContextSize();
	}

	getAvailableModels(): Promise<string[]> {
		return this.primary.getAvailableModels();
	}

	getProviderConfig(): ReturnType<LLMClient['getProviderConfig']> {
		return this.primary.getProviderConfig();
	}

	clearContext(): Promise<void> {
		return this.primary.clearContext();
	}

	getTimeout(): number | undefined {
		return this.primary.getTimeout();
	}

	async chat(
		messages: Message[],
		tools: Record<string, AISDKCoreTool>,
		callbacks: StreamCallbacks,
		signal?: AbortSignal,
		modeOverrides?: ModeOverrides,
	): Promise<LLMChatResponse> {
		const logger = getLogger();
		let lastError: unknown;

		try {
			return await this.primary.chat(
				messages,
				tools,
				callbacks,
				signal,
				modeOverrides,
			);
		} catch (error) {
			if (signal?.aborted || !isRetryableProviderError(error)) {
				throw error;
			}
			if (this.targets.length === 0) {
				throw error;
			}
			lastError = error;
			logger.warn('Primary provider failed, trying fallbacks', {
				provider: this.primaryName,
				error: error instanceof Error ? error.message : String(error),
				fallbacks: this.targets.map(t => t.provider),
			});
		}

		for (const target of this.targets) {
			if (signal?.aborted) {
				throw lastError ?? new Error('Operation was cancelled');
			}
			let fallbackClient: LLMClient;
			try {
				fallbackClient = await this.createFallbackClient(
					target.provider,
					target.model,
				);
			} catch (error) {
				// A misconfigured fallback must not kill the turn while a
				// later entry might still answer; the primary error stays the
				// one reported if nothing answers.
				logger.warn('Fallback provider could not be created, skipping', {
					provider: target.provider,
					error: error instanceof Error ? error.message : String(error),
				});
				continue;
			}

			try {
				const response = await fallbackClient.chat(
					messages,
					tools,
					callbacks,
					signal,
					modeOverrides,
				);
				const answeredModel = target.model ?? fallbackClient.getCurrentModel();
				response.fallbackProvider = target.provider;
				response.fallbackModel = answeredModel;
				const notice = buildFallbackNotice(this.primaryName, {
					...target,
					model: answeredModel,
				});
				logger.info('Fallback provider answered the turn', {
					primary: this.primaryName,
					fallback: target.provider,
					model: answeredModel,
				});
				callbacks.onNotice?.(notice);
				return response;
			} catch (error) {
				if (signal?.aborted || !isRetryableProviderError(error)) {
					throw error;
				}
				lastError = error;
				logger.warn('Fallback provider failed, trying next', {
					provider: target.provider,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		throw lastError ?? new Error('All providers failed');
	}
}
