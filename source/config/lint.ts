import {isOpenRouterProvider} from '@/ai-sdk-client/providers/openrouter';
import type {OpenRouterParameters, ProviderConfig} from '@/types/index';

/**
 * A non-fatal config problem found by the linter. `level` is informational —
 * the runtime only emits warnings today, but errors are reserved for future
 * misconfigurations that would unambiguously break a request (e.g. an
 * unreachable baseUrl scheme).
 */
export interface ConfigLintIssue {
	level: 'warning' | 'error';
	provider: string;
	message: string;
}

/**
 * Validate a single provider entry from `agents.config.json` against soft
 * rules that aren't enforced by TypeScript (because configs are loaded from
 * JSON at runtime). Returns an empty array for a clean config.
 *
 * Dispatches to per-provider linters by provider type — today only OpenRouter
 * has one. Add new linters by branching here, not by piling them all into a
 * single function.
 */
export function lintProviderConfig(
	provider: ProviderConfig,
): ConfigLintIssue[] {
	const issues: ConfigLintIssue[] = [];

	// OpenRouter block on a non-OpenRouter-named provider: silently ignored
	// today (detection is name-based), so warn loudly instead of letting the
	// user wonder why their routing rules aren't applied.
	if (provider.openrouter && !isOpenRouterProvider(provider.name)) {
		issues.push({
			level: 'warning',
			provider: provider.name,
			message: `Provider "${provider.name}" has an "openrouter" block but its name is not "openrouter" — the block will be ignored. Rename the provider to "openrouter" (case-insensitive) or remove the block.`,
		});
	}

	if (isOpenRouterProvider(provider.name) && provider.openrouter) {
		issues.push(...lintOpenRouter(provider.name, provider.openrouter));
	}

	return issues;
}

/**
 * Lint every provider in a config. Returns a flat list of issues across the
 * whole `providers` array. Used at startup and on provider switch.
 */
export function lintProviderConfigs(
	providers: ProviderConfig[],
): ConfigLintIssue[] {
	return providers.flatMap(lintProviderConfig);
}

/**
 * Render a lint issue as a single warning line suitable for the chat queue
 * or stderr. Keeps formatting consistent across call sites.
 */
export function formatConfigLintIssue(issue: ConfigLintIssue): string {
	return `[config] ${issue.message}`;
}

const OPENROUTER_KNOWN_KEYS = new Set<keyof OpenRouterParameters>([
	'provider',
	'reasoning',
	'models',
	'service_tier',
	'route',
	'plugins',
	'user',
	'extraBody',
]);

const SERVICE_TIER_VALUES = new Set(['flex', 'priority']);
const REASONING_EFFORTS = new Set([
	'xhigh',
	'high',
	'medium',
	'low',
	'minimal',
	'none',
]);
const SORT_KEYS = new Set(['price', 'throughput', 'latency']);
const DATA_COLLECTION_VALUES = new Set(['allow', 'deny']);

function lintOpenRouter(
	providerName: string,
	openrouter: OpenRouterParameters,
): ConfigLintIssue[] {
	const issues: ConfigLintIssue[] = [];
	const warn = (message: string) =>
		issues.push({level: 'warning', provider: providerName, message});

	// Unknown top-level keys catch typos like "service-tier" or "trans4orms".
	// We treat the openrouter block as a closed schema except for extraBody,
	// which is the explicit escape hatch.
	for (const key of Object.keys(openrouter)) {
		if (!OPENROUTER_KNOWN_KEYS.has(key as keyof OpenRouterParameters)) {
			warn(
				`Unknown key "openrouter.${key}". Use one of: ${[...OPENROUTER_KNOWN_KEYS].join(', ')}. Use "extraBody" for arbitrary fields.`,
			);
		}
	}

	if (
		openrouter.service_tier !== undefined &&
		!SERVICE_TIER_VALUES.has(openrouter.service_tier)
	) {
		warn(
			`openrouter.service_tier must be "flex" or "priority" (got "${String(openrouter.service_tier)}"). Note: "auto" is a response-only value and cannot be requested.`,
		);
	}

	const effort = openrouter.reasoning?.effort;
	if (effort !== undefined && !REASONING_EFFORTS.has(effort)) {
		warn(
			`openrouter.reasoning.effort must be one of ${[...REASONING_EFFORTS].join(', ')} (got "${String(effort)}").`,
		);
	}

	const sort = openrouter.provider?.sort;
	if (typeof sort === 'string' && !SORT_KEYS.has(sort)) {
		warn(
			`openrouter.provider.sort must be "price", "throughput", "latency", or an object form (got "${sort}").`,
		);
	}

	const dataCollection = openrouter.provider?.data_collection;
	if (
		dataCollection !== undefined &&
		!DATA_COLLECTION_VALUES.has(dataCollection)
	) {
		warn(
			`openrouter.provider.data_collection must be "allow" or "deny" (got "${String(dataCollection)}").`,
		);
	}

	return issues;
}
