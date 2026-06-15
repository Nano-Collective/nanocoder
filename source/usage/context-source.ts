import type {ApiUsage, ApiUsageSnapshot, ContextSource} from '@/types/core';

export interface ContextUsageResult {
	percent: number;
	source: ContextSource;
}

function isFiniteNumber(value: number | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Derive the context tokens occupied from a provider-reported usage object, or
 * `undefined` when the report isn't usable as a context numerator.
 *
 * Preference order:
 *   1. `inputTokens + outputTokens` — the prompt the model saw plus the reply
 *      just appended to history, which together equal the context now occupied.
 *   2. `totalTokens` — when the provider reports only a lump sum (no split).
 *
 * `inputTokens` (or a reported `totalTokens`) is required: a lone `outputTokens`
 * value describes only the reply and must NOT masquerade as the whole context,
 * which would otherwise show a confidently-wrong near-zero percentage. Non-finite
 * fields (NaN/Infinity) are treated as absent.
 */
function apiContextTokens(usage: ApiUsage): number | undefined {
	if (isFiniteNumber(usage.inputTokens)) {
		const output = isFiniteNumber(usage.outputTokens) ? usage.outputTokens : 0;
		return usage.inputTokens + output;
	}
	if (isFiniteNumber(usage.totalTokens)) {
		return usage.totalTokens;
	}
	return undefined;
}

/**
 * Decide the context-usage percentage and its provenance.
 *
 * The provider-reported total is the ground truth for everything it covers
 * (system prompt + tool definitions + history up to the snapshot). Rather than
 * discarding it the moment a new message arrives, we *anchor* on it and add a
 * client-side estimate of only the messages appended since (`estimatedTailTokens`,
 * which the caller also folds the in-flight streaming count into). That keeps the
 * accurate base for the bulk of the context and estimates only the small, fresh
 * tail — so the figure tracks the API closely turn to turn instead of swinging
 * between a 100%-API and a 100%-estimate number.
 *
 * Fallbacks:
 * - No usable snapshot, or one captured against a *longer* conversation than we
 *   currently have (e.g. just after a clear) → the full client-side estimate.
 * - A snapshot whose `atMessageCount` matches the conversation needs no tail.
 *
 * The tail only flips the source to `api+estimate` (and thus shows the `~`
 * marker) when it actually moves the rounded percentage; a just-typed short
 * message that rounds away stays labelled `api`.
 */
export function resolveContextUsage(params: {
	estimatedTotalTokens: number;
	estimatedTailTokens: number;
	apiSnapshot: ApiUsageSnapshot | null;
	currentMessageCount: number;
	contextLimit: number;
}): ContextUsageResult {
	const {
		estimatedTotalTokens,
		estimatedTailTokens,
		apiSnapshot,
		currentMessageCount,
		contextLimit,
	} = params;

	// Guard the exported helper against a zero/invalid limit; callers normally
	// pass a positive limit (the hook bails when it can't resolve one).
	if (!(contextLimit > 0)) {
		return {percent: 0, source: 'estimate'};
	}

	// The snapshot is only an anchor when it carries a usable numerator AND
	// describes a prefix of the current conversation (its message count hasn't
	// overtaken ours — which would mean it belongs to a since-cleared/compacted
	// history and must not be trusted).
	const apiTotal =
		apiSnapshot !== null && apiSnapshot.atMessageCount <= currentMessageCount
			? apiContextTokens(apiSnapshot)
			: undefined;

	if (apiTotal !== undefined) {
		const apiPercent = Math.round((apiTotal / contextLimit) * 100);
		const total = apiTotal + Math.max(0, estimatedTailTokens);
		const percent = Math.round((total / contextLimit) * 100);
		// Only call it estimated when the tail actually changed what's shown.
		return {percent, source: percent > apiPercent ? 'api+estimate' : 'api'};
	}

	return {
		percent: Math.round((estimatedTotalTokens / contextLimit) * 100),
		source: 'estimate',
	};
}
