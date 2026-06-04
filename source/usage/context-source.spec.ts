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

test('prefers API usage when the snapshot is fresh', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 9000,
		apiSnapshot: fresh,
		currentMessageCount: 4,
		contextLimit: 20000,
	});
	// (8000 + 2000) / 20000 = 50%, sourced from the API not the estimate.
	t.is(result.source, 'api');
	t.is(result.percent, 50);
});

test('falls back to estimation when the snapshot is stale (message count moved)', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 9000,
		apiSnapshot: fresh,
		currentMessageCount: 5, // a new message arrived since capture
		contextLimit: 20000,
	});
	// 9000 / 20000 = 45%, from the estimate.
	t.is(result.source, 'estimate');
	t.is(result.percent, 45);
});

test('falls back to estimation when there is no snapshot', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 6000,
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
		apiSnapshot: {atMessageCount: 2},
		currentMessageCount: 2,
		contextLimit: 20000,
	});
	t.is(result.source, 'estimate');
	t.is(result.percent, 30);
});

test('treats a partial snapshot (only inputTokens) as usable API data', t => {
	const result = resolveContextUsage({
		estimatedTotalTokens: 9999,
		apiSnapshot: {inputTokens: 5000, atMessageCount: 3},
		currentMessageCount: 3,
		contextLimit: 20000,
	});
	// inputTokens (5000) + missing outputTokens (treated as 0) = 25%.
	t.is(result.source, 'api');
	t.is(result.percent, 25);
});
