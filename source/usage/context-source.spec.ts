import test from 'ava';
import type {ApiUsageSnapshot} from '@/types/core.js';
import {resolveContextUsage} from './context-source.js';

console.log('\ncontext-source.spec.ts');

const fresh: ApiUsageSnapshot = {
	inputTokens: 8000,
	outputTokens: 2000,
	totalTokens: 10000,
	atMessageCount: 4,
};

test('uses API usage with no tilde when the snapshot covers the whole conversation', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 9000,
		estimatedTailTokens: 0,
		apiSnapshot: fresh,
		currentMessageCount: 4,
		contextLimit: 20000,
	});
	// (8000 + 2000) / 20000 = 50%, sourced purely from the API.
	t.is(result.source, 'api');
	t.is(result.percent, 50);
});

test('anchors on API and adds the estimated tail when newer messages arrived', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 99999, // full estimate is ignored while anchoring
		estimatedTailTokens: 2000, // a new message + in-flight reply since capture
		apiSnapshot: fresh,
		currentMessageCount: 5,
		contextLimit: 20000,
	});
	// (10000 anchor + 2000 tail) / 20000 = 60%, marked as part-estimated.
	t.is(result.source, 'api+estimate');
	t.is(result.percent, 60);
});

test('keeps the api source when the estimated tail is too small to move the percentage', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 99999,
		estimatedTailTokens: 50, // rounds away against a 20k window
		apiSnapshot: fresh,
		currentMessageCount: 5,
		contextLimit: 20000,
	});
	// (10000 + 50) / 20000 = 50.25% → rounds to 50%, same as pure API → no tilde.
	t.is(result.source, 'api');
	t.is(result.percent, 50);
});

test('ignores a snapshot captured against a longer (since-cleared) conversation', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 6000,
		estimatedTailTokens: 0,
		apiSnapshot: fresh, // atMessageCount 4
		currentMessageCount: 2, // conversation is now shorter than the snapshot
		contextLimit: 20000,
	});
	// Snapshot overtook us → distrust it, use the full estimate. 6000/20000 = 30%.
	t.is(result.source, 'estimate');
	t.is(result.percent, 30);
});

test('falls back to estimation when there is no snapshot', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 6000,
		estimatedTailTokens: 0,
		apiSnapshot: null,
		currentMessageCount: 2,
		contextLimit: 20000,
	});
	t.is(result.source, 'estimate');
	t.is(result.percent, 30);
});

test('falls back to estimation when the snapshot reported no token fields', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 6000,
		estimatedTailTokens: 0,
		apiSnapshot: {atMessageCount: 2},
		currentMessageCount: 2,
		contextLimit: 20000,
	});
	t.is(result.source, 'estimate');
	t.is(result.percent, 30);
});

test('treats a partial snapshot (only inputTokens) as a usable anchor', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 9999,
		estimatedTailTokens: 0,
		apiSnapshot: {inputTokens: 5000, atMessageCount: 3},
		currentMessageCount: 3,
		contextLimit: 20000,
	});
	// inputTokens (5000) + missing outputTokens (treated as 0) = 25%.
	t.is(result.source, 'api');
	t.is(result.percent, 25);
});

test('uses a reported totalTokens lump sum when input/output are not split', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 9999,
		estimatedTailTokens: 0,
		apiSnapshot: {totalTokens: 5000, atMessageCount: 3},
		currentMessageCount: 3,
		contextLimit: 20000,
	});
	// 5000 / 20000 = 25%, sourced from the reported total.
	t.is(result.source, 'api');
	t.is(result.percent, 25);
});

test('falls back to estimation when only outputTokens is reported (no context anchor)', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 9000,
		estimatedTailTokens: 0,
		apiSnapshot: {outputTokens: 300, atMessageCount: 3},
		currentMessageCount: 3,
		contextLimit: 20000,
	});
	// A lone reply size must not masquerade as the whole context → estimate.
	t.is(result.source, 'estimate');
	t.is(result.percent, 45);
});

test('falls back to estimation when token fields are non-finite (NaN/Infinity)', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 9000,
		estimatedTailTokens: 0,
		apiSnapshot: {inputTokens: Number.NaN, atMessageCount: 3},
		currentMessageCount: 3,
		contextLimit: 20000,
	});
	t.is(result.source, 'estimate');
	t.is(result.percent, 45);
});

test('clamps a negative estimated tail to zero (never below the anchor)', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 9000,
		estimatedTailTokens: -500,
		apiSnapshot: fresh,
		currentMessageCount: 6,
		contextLimit: 20000,
	});
	// Negative tail ignored → stays at the 50% anchor with no tilde.
	t.is(result.source, 'api');
	t.is(result.percent, 50);
});

test('returns 0% estimate when the context limit is not positive', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 9000,
		estimatedTailTokens: 0,
		apiSnapshot: fresh,
		currentMessageCount: 4,
		contextLimit: 0,
	});
	t.is(result.source, 'estimate');
	t.is(result.percent, 0);
});
