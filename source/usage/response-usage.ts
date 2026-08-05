/**
 * Builds the per-response usage payload (provider-reported tokens plus
 * estimated cost) displayed under each assistant message.
 */

import {getModelPricing} from '@/models/index';
import type {ApiUsage} from '@/types/core';
import type {ResponseUsage} from '@/types/usage';

type PricingLookup = (
	model: string,
) => Promise<{input: number; output: number} | null>;

/**
 * Convert a provider-reported usage object into a `ResponseUsage` with a
 * best-effort cost estimate. Returns undefined when the provider reported
 * no usable token counts (the indicator then falls back to the client-side
 * estimate). Cost is omitted when pricing is unavailable (local models) or
 * the lookup fails — never blocks or throws.
 */
export async function buildResponseUsage(
	usage: ApiUsage | undefined,
	model: string,
	getPricing: PricingLookup = getModelPricing,
): Promise<ResponseUsage | undefined> {
	const hasReportedUsage =
		!!usage &&
		(Number.isFinite(usage.inputTokens) ||
			Number.isFinite(usage.outputTokens) ||
			Number.isFinite(usage.totalTokens));
	if (!hasReportedUsage) {
		return undefined;
	}

	let cost: number | undefined;
	try {
		const pricing = await getPricing(model);
		if (pricing) {
			if (
				Number.isFinite(usage.inputTokens) &&
				Number.isFinite(usage.outputTokens)
			) {
				cost =
					(pricing.input * (usage.inputTokens as number) +
						pricing.output * (usage.outputTokens as number)) /
					1_000_000;
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

	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		totalTokens: usage.totalTokens,
		cost,
	};
}
