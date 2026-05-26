/**
 * Intent classifier for the Router + Specialist system.
 *
 * Implements a 3-tier fallback classification pipeline adapted from
 * LocalClaw's `src/router/classifier.ts`:
 *
 *   1. Pre-model overrides — high-confidence regex patterns
 *   2. Model classification — small fast model classifies in ~50ms
 *   3. Keyword heuristics — pattern matching when model fails/times out
 *   4. Default fallback → 'chat'
 *
 * Sticky routing keeps follow-up messages on the same specialist for
 * conversation-oriented categories (chat, code_explore).
 */

import {loadAllProviderConfigs} from '@/config/mcp-config-loader';
import type {LLMClient, Message} from '@/types/core';
import {getLogger} from '@/utils/logging';
import {isLocalURL} from '@/utils/url-utils';
import {
	GREETING_PATTERNS,
	KEYWORD_HINTS,
	NEW_TOPIC_PATTERNS,
	PRE_MODEL_OVERRIDES,
} from './keyword-hints';
import {buildRouterPrompt, cleanCategoryResponse} from './prompt';
import {
	type ClassifyResult,
	type RouterConfig,
	SPECIALIST_CATEGORIES,
	type SpecialistCategory,
	STICKY_CATEGORIES,
} from './types';

// ─── Module state ──────────────────────────────────────────────

/** Cached router client — created lazily and reused across calls. */
let cachedRouterClient: LLMClient | null = null;
let cachedRouterModel: string | null = null;

/**
 * Initialise or return the cached router LLM client.  We create a
 * separate client because the router may use a different (smaller) model
 * than the main specialist.  The function is idempotent and only
 * recreates the client when the model name changes.
 */
export async function getRouterClient(model: string): Promise<LLMClient> {
	if (cachedRouterClient && cachedRouterModel === model) {
		return cachedRouterClient;
	}

	// Dynamic import to avoid pulling the full client factory at module
	// load time when the router is not used.
	const {createLLMClient} = await import('@/client-factory');
	const {client} = await createLLMClient(undefined, model);
	cachedRouterClient = client;
	cachedRouterModel = model;
	return client;
}

/** Reset the cached router client (for testing). */
export function resetRouterClient(): void {
	cachedRouterClient = null;
	cachedRouterModel = null;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Default router config.  The model field is deliberately empty —
 * callers must supply a concrete model name (typically from the local
 * model workflow config or the active provider's model list).
 */
export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
	model: '',
	timeout: 2000,
	defaultCategory: 'chat',
	categories: {},
};

/**
 * Classify a user message into a specialist category.
 *
 * Pipeline:
 *   1. Pre-model overrides (regex patterns)
 *   2. Sticky routing (follow-up detection)
 *   3. Model classification
 *   4. Keyword heuristics fallback
 *   5. Default category
 */
export async function classifyMessage(
	message: string,
	previousCategory?: SpecialistCategory,
	config: RouterConfig = DEFAULT_ROUTER_CONFIG,
): Promise<ClassifyResult> {
	const validCategories = new Set<string>(SPECIALIST_CATEGORIES);
	const logger = getLogger();

	// ── Tier 0: Pre-model overrides ──────────────────────────
	for (const override of PRE_MODEL_OVERRIDES) {
		if (
			override.pattern.test(message) &&
			validCategories.has(override.category)
		) {
			logger.debug('[Router] Pre-model override', {
				snippet: message.slice(0, 60),
				category: override.category,
			});
			return {
				category: override.category,
				confidence: 'pre_model_override',
			};
		}
	}

	// ── Tier 1: Sticky routing ───────────────────────────────
	if (
		previousCategory &&
		validCategories.has(previousCategory) &&
		STICKY_CATEGORIES.has(previousCategory) &&
		isLikelyFollowUp(message, previousCategory)
	) {
		// Check if keywords point to a DIFFERENT category
		const keywordHit = applyKeywordHeuristics(message, validCategories);
		if (keywordHit && keywordHit !== previousCategory) {
			logger.debug('[Router] Sticky override — keyword wins', {
				snippet: message.slice(0, 60),
				keyword: keywordHit,
				sticky: previousCategory,
			});
			// Fall through to model / keyword classification
		} else {
			logger.debug('[Router] Sticky follow-up', {
				snippet: message.slice(0, 60),
				category: previousCategory,
			});
			return {category: previousCategory, confidence: 'sticky'};
		}
	}

	// ── Tier 2: Model classification ─────────────────────────
	if (config.model) {
		try {
			const client = await getRouterClient(config.model);
			const prompt = buildRouterPrompt(message, config);

			const result = await client.chat(
				[{role: 'user', content: prompt} as Message],
				{}, // no tools — pure text classification
				{
					onToken: () => {},
				},
				AbortSignal.timeout(config.timeout),
			);

			const raw = result?.choices?.[0]?.message?.content?.trim() ?? '';
			const parsed = cleanCategoryResponse(raw);

			if (parsed && validCategories.has(parsed)) {
				logger.debug('[Router] Model classification', {
					snippet: message.slice(0, 60),
					category: parsed,
					raw,
				});
				return {category: parsed, confidence: 'model'};
			}

			logger.debug('[Router] Model returned invalid category', {raw});
		} catch (error) {
			logger.debug('[Router] Model classification failed', {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	// ── Tier 3: Keyword heuristics ───────────────────────────
	const keywordHit = applyKeywordHeuristics(message, validCategories);
	if (keywordHit) {
		logger.debug('[Router] Keyword heuristic', {
			snippet: message.slice(0, 60),
			category: keywordHit,
		});
		return {category: keywordHit, confidence: 'keyword'};
	}

	// ── Tier 4: Default fallback ─────────────────────────────
	logger.debug('[Router] Default fallback', {
		snippet: message.slice(0, 60),
		category: config.defaultCategory,
	});
	return {category: config.defaultCategory, confidence: 'fallback'};
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Apply keyword hint patterns in order. First match wins.
 */
function applyKeywordHeuristics(
	message: string,
	validCategories: Set<string>,
): SpecialistCategory | null {
	for (const hint of KEYWORD_HINTS) {
		if (hint.pattern.test(message) && validCategories.has(hint.category)) {
			return hint.category;
		}
	}
	return null;
}

/**
 * Determine whether a message is likely a follow-up to the previous
 * specialist category.  Only conversation-oriented categories are
 * eligible for sticky routing.
 */
function isLikelyFollowUp(
	message: string,
	previousCategory: SpecialistCategory,
): boolean {
	const trimmed = message.trim();

	// Commands are never follow-ups
	if (trimmed.startsWith('/')) return false;

	// Only conversation-oriented categories are sticky
	if (!STICKY_CATEGORIES.has(previousCategory)) return false;

	// Explicit imperative task commands break sticky
	const isImperativeTask =
		/^(build|create|make|generate|write|scaffold|implement|search\s+for|run|execute|send|schedule)\b/i.test(
			trimmed,
		);
	if (isImperativeTask) return false;

	// Long conversational messages without imperative task — keep sticky
	if (trimmed.length > 200) return true;

	// Strong new-topic signals override stickiness
	if (hasStrongNewTopicSignal(trimmed)) return false;

	// Simple greetings are never follow-ups
	if (isGreeting(trimmed)) return false;

	// Short continuation of a conversation-oriented specialist
	return true;
}

function hasStrongNewTopicSignal(message: string): boolean {
	return NEW_TOPIC_PATTERNS.some(p => p.test(message));
}

function isGreeting(message: string): boolean {
	return GREETING_PATTERNS.some(p => p.test(message));
}

// ─── Local provider detection ─────────────────────────────────

/**
 * Determine whether the currently active provider is a local model
 * server (Ollama, llama.cpp, LM Studio, etc.) based on its baseURL.
 */
export function isActiveProviderLocal(providerName: string): boolean {
	const providers = loadAllProviderConfigs();
	const provider = providers.find(
		p => p.name.toLowerCase() === providerName.toLowerCase(),
	);
	if (!provider) return false;

	const baseURL = provider.baseUrl;
	if (typeof baseURL === 'string') {
		return isLocalURL(baseURL);
	}

	return false;
}

/**
 * Determine whether the local model workflow should be activated
 * for the current session.
 */
export function shouldActivateRouter(
	localModelWorkflowEnabled: boolean | undefined,
	activateForLocalProviders: boolean | undefined,
	providerName: string,
): boolean {
	if (localModelWorkflowEnabled === true) return true;
	if (localModelWorkflowEnabled === false) return false;
	// Default: activate for local providers unless explicitly disabled
	return (
		activateForLocalProviders !== false && isActiveProviderLocal(providerName)
	);
}
