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

export function priceTokens(
	pricing: TokenPricing,
	usage: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	},
): number {
	const cacheRead = usage.cacheReadTokens ?? 0;
	const cacheWrite = usage.cacheWriteTokens ?? 0;
	const uncachedInput = Math.max(
		0,
		(usage.inputTokens ?? 0) - cacheRead - cacheWrite,
	);
	return (
		(pricing.input * uncachedInput +
			(pricing.cache_read ?? pricing.input) * cacheRead +
			(pricing.cache_write ?? pricing.input) * cacheWrite +
			pricing.output * (usage.outputTokens ?? 0)) /
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
		(Number.isFinite(usage.inputTokens) ||
			Number.isFinite(usage.outputTokens) ||
			Number.isFinite(usage.totalTokens));
	if (!hasReportedUsage) {
		return undefined;
	}
	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		totalTokens: usage.totalTokens,
		cacheReadTokens: usage.cacheReadTokens,
		cacheWriteTokens: usage.cacheWriteTokens,
	};
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
			// A zero input+output pair alongside a positive total means the
			// split is unknown (zero-filled), not free — price the lump sum.
			const hasUsableSplit =
				Number.isFinite(usage.inputTokens) &&
				Number.isFinite(usage.outputTokens) &&
				((usage.inputTokens as number) > 0 ||
					(usage.outputTokens as number) > 0 ||
					!(usage.totalTokens && usage.totalTokens > 0));
			if (hasUsableSplit) {
				cost = priceTokens(pricing, usage);
			} else if (Number.isFinite(usage.totalTokens)) {
				// Lump-sum reports can't be split into input/output, so average
				// the two rates — same approximation the /usage command uses.
				cost =
					(((pricing.input + pricing.output) / 2) *
						(usage.totalTokens as number)) /
					1_000_000;
			}
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
