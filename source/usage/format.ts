/**
 * Formatters for the per-response usage indicator shown under each
 * assistant message, e.g. `Tokens: 4.2k | ~$0.01`.
 */

import type {ResponseUsage} from '@/types/usage';

/**
 * Format a token count compactly: 812, 4.2k, 12k, 1.3M.
 */
export function formatCompactTokenCount(tokens: number): string {
	if (!Number.isFinite(tokens) || tokens <= 0) {
		return '0';
	}
	if (tokens < 1000) {
		return String(Math.round(tokens));
	}
	if (tokens < 1_000_000) {
		return `${trimTrailingZero(tokens / 1000)}k`;
	}
	return `${trimTrailingZero(tokens / 1_000_000)}M`;
}

/**
 * One decimal place below 100, whole numbers above (4.2, 99.9, 120).
 */
function trimTrailingZero(value: number): string {
	if (value >= 100) {
		return String(Math.round(value));
	}
	return value.toFixed(1).replace(/\.0$/, '');
}

/**
 * Format an estimated cost in USD. Returns null when the cost is zero,
 * negative, or not a finite number — free/local models should show no
 * cost segment rather than "$0.00".
 */
export function formatCost(cost: number): string | null {
	if (!Number.isFinite(cost) || cost <= 0) {
		return null;
	}
	if (cost < 0.01) {
		return '<$0.01';
	}
	return `~$${cost.toFixed(2)}`;
}

/**
 * Total tokens for a usage report: prefer the provider's lump-sum total,
 * fall back to summing whichever of input/output were reported. Returns
 * null when no field is usable.
 */
export function getTotalTokens(usage: ResponseUsage): number | null {
	const total =
		Number.isFinite(usage.totalTokens) && (usage.totalTokens as number) >= 0
			? (usage.totalTokens as number)
			: null;
	if (total !== null && total > 0) return total;
	const input = Number.isFinite(usage.inputTokens)
		? (usage.inputTokens as number)
		: null;
	const output = Number.isFinite(usage.outputTokens)
		? (usage.outputTokens as number)
		: null;
	const cache =
		(Number.isFinite(usage.cacheReadTokens)
			? (usage.cacheReadTokens as number)
			: 0) +
		(Number.isFinite(usage.cacheWriteTokens)
			? (usage.cacheWriteTokens as number)
			: 0);
	if (input == null && output == null) {
		if (cache > 0) return cache;
		return total;
	}
	// If input is absent, cache details are the missing input component. When
	// input is present they are already included in the provider input total.
	const components = (input ?? 0) + (output ?? 0) + (input == null ? cache : 0);
	return components > 0 || total === null ? components : total;
}

/**
 * Build the indicator string for a response, e.g. `Tokens: 4.2k | ~$0.01`
 * or `Tokens: 812` when no pricing is available. Returns null when the
 * usage report carries no usable token counts.
 */
export function formatUsageIndicator(usage: ResponseUsage): string | null {
	const total = getTotalTokens(usage);
	if (total == null) {
		return null;
	}
	const parts = [`Tokens: ${formatCompactTokenCount(total)}`];
	const cacheRead = usage.cacheReadTokens;
	if (Number.isFinite(cacheRead) && (cacheRead as number) > 0) {
		parts.push(`${formatCompactTokenCount(cacheRead as number)} cached`);
	}
	const cost = usage.cost != null ? formatCost(usage.cost) : null;
	if (cost) {
		parts.push(cost);
	}
	return parts.join(' | ');
}
