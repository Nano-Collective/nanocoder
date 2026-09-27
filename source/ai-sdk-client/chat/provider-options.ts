import type {AIProviderConfig, ModelParameters} from '@/types/index';
import {isOpenRouterProvider} from '../providers/openrouter.js';

/**
 * Provider-scoped extras forwarded to streamText/generateText via
 * `providerOptions`. The outer key is the provider id (e.g. "openai" for the
 * OpenAI Responses API, or the provider name for openai-compatible providers
 * like OpenRouter). The inner shape depends on the provider.
 *
 * Kept loose on purpose — the AI SDK's exact type lives in
 * `@ai-sdk/provider-utils`, which we don't depend on directly. The chat
 * handler casts the return value to the SDK's narrower type at the call
 * site, where it spreads into `streamText`.
 */
export type ProviderOptions = Record<string, Record<string, unknown>>;

/**
 * Whether to mark this provider's requests with Anthropic cache breakpoints.
 *
 * Anthropic-only and on by default there. `promptCaching: true` on any other
 * SDK provider is deliberately inert rather than an error: OpenAI and
 * OpenRouter prefix-cache on their own, and local models have no cache.
 */
export function isPromptCachingEnabled(
	providerConfig: AIProviderConfig,
): boolean {
	return (
		providerConfig.sdkProvider === 'anthropic' &&
		providerConfig.promptCaching !== false
	);
}

/**
 * Build the `providerOptions` value for a streamText/generateText call.
 *
 * Currently handles three provider paths:
 *   - chatgpt-codex: requires `instructions`, `store: false`, and reasoning
 *     controls under the `openai` provider key (Responses API).
 *   - openrouter: forwards `provider`, `reasoning`, `plugins`, `models`,
 *     `service_tier`, `route`, and `user` into the request body, keyed by
 *     the provider's configured name (see openAICompatibleOptionsKey). The
 *     top-level `reasoningEffort` (from ModelParameters / `/tune`) is mapped
 *     to `reasoning.effort` when the user has not provided a more specific
 *     `openrouter.reasoning` block.
 *   - other openai-compatible providers: forwards an explicitly configured
 *     `reasoningEffort`, which the SDK serialises as `reasoning_effort`.
 *
 * OpenRouter options come from `providerConfig.openrouter` (always-on, set
 * in agents.config.json) — not from tune, so they aren't dropped when the
 * user toggles tune off.
 *
 * Returns `undefined` when no provider-specific options apply, so the SDK
 * call site can spread it without producing an empty `providerOptions: {}`.
 */
export function buildProviderOptions(
	providerConfig: AIProviderConfig,
	systemContent: string,
	modelParameters: ModelParameters | undefined,
): ProviderOptions | undefined {
	if (providerConfig.sdkProvider === 'chatgpt-codex') {
		return {
			openai: {
				...(systemContent ? {instructions: systemContent} : {}),
				store: false,
				reasoningEffort: modelParameters?.reasoningEffort ?? 'medium',
				reasoningSummary: modelParameters?.reasoningSummary ?? 'auto',
			},
		};
	}

	if (isOpenRouterProvider(providerConfig.name)) {
		const openrouter = providerConfig.openrouter;
		const reasoning = buildOpenRouterReasoning(openrouter, modelParameters);

		// Start from the generic escape-hatch so typed fields below can
		// override anything the user happened to spell the same way.
		const payload: Record<string, unknown> = {
			...(openrouter?.extraBody ?? {}),
		};
		if (openrouter?.provider !== undefined) {
			payload['provider'] = openrouter.provider;
		}
		if (reasoning !== undefined) {
			payload['reasoning'] = reasoning;
		}
		if (openrouter?.plugins !== undefined) {
			payload['plugins'] = openrouter.plugins;
		}
		if (openrouter?.models !== undefined) {
			payload['models'] = openrouter.models;
		}
		if (openrouter?.service_tier !== undefined) {
			payload['service_tier'] = openrouter.service_tier;
		}
		if (openrouter?.route !== undefined) {
			payload['route'] = openrouter.route;
		}
		if (openrouter?.user !== undefined) {
			payload['user'] = openrouter.user;
		}

		if (Object.keys(payload).length === 0) {
			return undefined;
		}
		return {[openAICompatibleOptionsKey(providerConfig.name)]: payload};
	}

	// The generic OpenAI-compatible SDK is the default when sdkProvider is
	// omitted. Unlike chatgpt-codex, do not invent a default here: many models
	// reject reasoning_effort, so it must only be sent when explicitly set.
	if (
		(providerConfig.sdkProvider === undefined ||
			providerConfig.sdkProvider === 'openai-compatible') &&
		modelParameters?.reasoningEffort !== undefined
	) {
		return {
			[openAICompatibleOptionsKey(providerConfig.name)]: {
				reasoningEffort: modelParameters.reasoningEffort,
			},
		};
	}

	return undefined;
}

/**
 * The `providerOptions` key `@ai-sdk/openai-compatible` reads for a provider
 * created with `createOpenAICompatible({name})`. The SDK uses the exact
 * provider name (up to the first dot, trimmed), not a lowercased id, so a
 * provider named "OpenRouter" must receive its options under "OpenRouter".
 */
function openAICompatibleOptionsKey(providerName: string): string {
	return providerName.split('.')[0].trim();
}

/**
 * Resolve OpenRouter's `reasoning` body field by merging the top-level
 * `reasoningEffort` shortcut (from ModelParameters / `/tune`) with the more
 * granular `openrouter.reasoning` block on the provider config. The
 * provider-config block wins on key conflicts so always-on routing rules
 * aren't accidentally overridden by transient session state.
 */
function buildOpenRouterReasoning(
	openrouter: AIProviderConfig['openrouter'],
	modelParameters: ModelParameters | undefined,
): Record<string, unknown> | undefined {
	const explicit = openrouter?.reasoning;
	const effortShortcut = modelParameters?.reasoningEffort;

	if (!explicit && !effortShortcut) return undefined;

	return {
		...(effortShortcut ? {effort: effortShortcut} : {}),
		...explicit,
	};
}
