/**
 * Builds the per-response usage payload (provider-reported tokens plus
 * estimated cost) displayed under each assistant message.
 */

import {TIMEOUT_COST_LOOKUP_MS} from '@/constants';
import {getModelPricing} from '@/models/index';
import type {ApiUsage} from '@/types/core';
import type {ResponseUsage} from '@/types/usage';

export interface TokenPricing {
	input: number;
	output: number;
	cache_read?: number;
	cache_write?: number;
}

type PricingLookup = (model: string) => Promise<TokenPricing | null>;

function finiteTokenCount(value: number | undefined): number | undefined {
	return Number.isFinite(value) && (value as number) >= 0
		? (value as number)
		: undefined;
}

/**
 * Price a usage report, billing cache reads and writes at their own models.dev
 * rates and the remainder at the full input rate.
 *
 * The subtraction below is only valid because `inputTokens` is *inclusive* of
 * the cache counts: the AI SDK reports `inputTokens.total = noCache +
 * cacheRead + cacheWrite` (see `convertAnthropicMessagesUsage`), and OpenAI's
 * `prompt_tokens` likewise counts its cached tokens. Do not "fix" this into a
 * plain addition without re-checking that invariant for the provider in hand.
 * When models.dev publishes no cache rates the input rate is used for all
 * three, which reproduces the pre-caching cost exactly.
 */
export function priceTokens(
	pricing: TokenPricing,
	usage: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	},
): number {
	const inputTokens = finiteTokenCount(usage.inputTokens) ?? 0;
	const outputTokens = finiteTokenCount(usage.outputTokens) ?? 0;
	const cacheRead = finiteTokenCount(usage.cacheReadTokens) ?? 0;
	const cacheWrite = finiteTokenCount(usage.cacheWriteTokens) ?? 0;
	const uncachedInput = Math.max(0, inputTokens - cacheRead - cacheWrite);
	return (
		(pricing.input * uncachedInput +
			(pricing.cache_read ?? pricing.input) * cacheRead +
			(pricing.cache_write ?? pricing.input) * cacheWrite +
			pricing.output * outputTokens) /
		1_000_000
	);
}

/**
 * Extract the provider-reported token counts, or undefined when the report
 * carries no usable field (the indicator then falls back to the client-side
 * estimate).
 */
function toReportedUsage(
	usage: ApiUsage | undefined,
): ResponseUsage | undefined {
	const hasReportedUsage =
		!!usage &&
		(finiteTokenCount(usage.inputTokens) !== undefined ||
			finiteTokenCount(usage.outputTokens) !== undefined ||
			finiteTokenCount(usage.totalTokens) !== undefined ||
			finiteTokenCount(usage.cacheReadTokens) !== undefined ||
			finiteTokenCount(usage.cacheWriteTokens) !== undefined);
	if (!hasReportedUsage) {
		return undefined;
	}
	return {
		inputTokens: finiteTokenCount(usage.inputTokens),
		outputTokens: finiteTokenCount(usage.outputTokens),
		totalTokens: finiteTokenCount(usage.totalTokens),
		cacheReadTokens: finiteTokenCount(usage.cacheReadTokens),
		cacheWriteTokens: finiteTokenCount(usage.cacheWriteTokens),
	};
}

/** Calculate a best-effort USD cost from a provider usage report. */
export function calculateUsageCost(
	usage: ApiUsage,
	pricing: TokenPricing,
): number | undefined {
	const inputTokens = finiteTokenCount(usage.inputTokens);
	const outputTokens = finiteTokenCount(usage.outputTokens);
	const totalTokens = finiteTokenCount(usage.totalTokens);
	const cacheReadTokens = finiteTokenCount(usage.cacheReadTokens);
	const cacheWriteTokens = finiteTokenCount(usage.cacheWriteTokens);
	const hasCacheDetail =
		(cacheReadTokens ?? 0) > 0 || (cacheWriteTokens ?? 0) > 0;

	if (hasCacheDetail) {
		// AI SDK's inputTokens includes the cached input details. Price the
		// uncached remainder at the normal input rate and use the provider's
		// cache rates when available. If a provider has no cache-specific
		// rate, the normal input rate is the conservative fallback.
		const inputTotal =
			inputTokens ??
			(totalTokens !== undefined
				? Math.max(0, totalTokens - (outputTokens ?? 0))
				: 0);
		const uncachedInput = Math.max(
			0,
			inputTotal - (cacheReadTokens ?? 0) - (cacheWriteTokens ?? 0),
		);
		return (
			(pricing.input * uncachedInput +
				(pricing.cache_read ?? pricing.input) * (cacheReadTokens ?? 0) +
				(pricing.cache_write ?? pricing.input) * (cacheWriteTokens ?? 0) +
				pricing.output * (outputTokens ?? 0)) /
			1_000_000
		);
	}

	if (
		inputTokens !== undefined &&
		outputTokens !== undefined &&
		(inputTokens > 0 ||
			outputTokens > 0 ||
			!(totalTokens !== undefined && totalTokens > 0))
	) {
		// A zero input+output pair alongside a positive total means the
		// split is unknown (zero-filled), not free — handled below.
		return (
			(pricing.input * inputTokens + pricing.output * outputTokens) / 1_000_000
		);
	}

	if (
		totalTokens !== undefined &&
		(inputTokens !== undefined || outputTokens !== undefined) &&
		!(inputTokens === 0 && outputTokens === 0 && totalTokens > 0)
	) {
		// If one side of the split is missing, infer it from the provider
		// total rather than silently dropping that side of the cost.
		const inferredInput =
			inputTokens ?? Math.max(0, totalTokens - (outputTokens ?? 0));
		const inferredOutput =
			outputTokens ?? Math.max(0, totalTokens - (inputTokens ?? 0));
		return (
			(pricing.input * inferredInput + pricing.output * inferredOutput) /
			1_000_000
		);
	}

	if (totalTokens !== undefined) {
		// Lump-sum reports can't be split into input/output, so average
		// the two rates — the same approximation used by /usage.
		return (((pricing.input + pricing.output) / 2) * totalTokens) / 1_000_000;
	}

	if (inputTokens !== undefined || outputTokens !== undefined) {
		return (
			(pricing.input * (inputTokens ?? 0) +
				pricing.output * (outputTokens ?? 0)) /
			1_000_000
		);
	}

	return undefined;
}

/**
 * Convert a provider-reported usage object into a `ResponseUsage` with a
 * best-effort cost estimate. Returns undefined when the provider reported
 * no usable token counts (the indicator then falls back to the client-side
 * estimate). Cost is omitted when pricing is unavailable (local models) or
 * the lookup fails — never throws.
 */
export async function buildResponseUsage(
	usage: ApiUsage | undefined,
	model: string,
	getPricing: PricingLookup = getModelPricing,
): Promise<ResponseUsage | undefined> {
	const reported = toReportedUsage(usage);
	if (!reported || !usage) {
		return undefined;
	}

	let cost: number | undefined;
	try {
		const pricing = await getPricing(model);
		if (pricing) {
			cost = calculateUsageCost(usage, pricing);
		}
	} catch {
		// Best-effort: no cost segment when the pricing lookup fails.
	}

	return {...reported, cost};
}

/**
 * Like `buildResponseUsage`, but bounded: if the pricing lookup does not
 * resolve within `timeoutMs` (cold models.dev cache, offline fetch), the
 * token counts are returned without a cost segment so the caller never
 * blocks the render path on disk or network. The underlying lookup keeps
 * running and its result is memoized in the models client, so the next
 * response picks the cost up instantly.
 */
export async function buildResponseUsageBounded(
	usage: ApiUsage | undefined,
	model: string,
	options: {timeoutMs?: number; getPricing?: PricingLookup} = {},
): Promise<ResponseUsage | undefined> {
	const reported = toReportedUsage(usage);
	if (!reported) {
		return undefined;
	}

	const {timeoutMs = TIMEOUT_COST_LOOKUP_MS, getPricing} = options;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const bounded = await Promise.race([
			buildResponseUsage(usage, model, getPricing),
			new Promise<ResponseUsage>(resolve => {
				timer = setTimeout(() => resolve(reported), timeoutMs);
			}),
		]);
		return bounded ?? reported;
	} finally {
		clearTimeout(timer);
	}
}
