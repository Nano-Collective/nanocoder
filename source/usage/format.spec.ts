import test from 'ava';
import {
	formatCompactTokenCount,
	formatCost,
	formatUsageIndicator,
	getTotalTokens,
} from './format.js';

console.log('\nformat.spec.ts');

// ============================================================================
// formatCompactTokenCount
// ============================================================================

test('formatCompactTokenCount renders small counts as-is', t => {
	t.is(formatCompactTokenCount(1), '1');
	t.is(formatCompactTokenCount(812), '812');
	t.is(formatCompactTokenCount(999), '999');
});

test('formatCompactTokenCount renders thousands with one decimal', t => {
	t.is(formatCompactTokenCount(1000), '1k');
	t.is(formatCompactTokenCount(4200), '4.2k');
	t.is(formatCompactTokenCount(4250), '4.3k');
	t.is(formatCompactTokenCount(99_900), '99.9k');
});

test('formatCompactTokenCount rounds to whole numbers above 100k', t => {
	t.is(formatCompactTokenCount(128_000), '128k');
	t.is(formatCompactTokenCount(128_500), '129k');
});

test('formatCompactTokenCount renders millions', t => {
	t.is(formatCompactTokenCount(1_000_000), '1M');
	t.is(formatCompactTokenCount(1_300_000), '1.3M');
	t.is(formatCompactTokenCount(120_000_000), '120M');
});

test('formatCompactTokenCount handles invalid input', t => {
	t.is(formatCompactTokenCount(0), '0');
	t.is(formatCompactTokenCount(-5), '0');
	t.is(formatCompactTokenCount(Number.NaN), '0');
	t.is(formatCompactTokenCount(Number.POSITIVE_INFINITY), '0');
});

// ============================================================================
// formatCost
// ============================================================================

test('formatCost formats cents and above with two decimals', t => {
	t.is(formatCost(0.01), '~$0.01');
	t.is(formatCost(0.042), '~$0.04');
	t.is(formatCost(1.5), '~$1.50');
});

test('formatCost renders sub-cent costs as <$0.01', t => {
	t.is(formatCost(0.0042), '<$0.01');
	t.is(formatCost(0.0099), '<$0.01');
});

test('formatCost returns null for zero, negative, and invalid costs', t => {
	t.is(formatCost(0), null);
	t.is(formatCost(-0.5), null);
	t.is(formatCost(Number.NaN), null);
	t.is(formatCost(Number.POSITIVE_INFINITY), null);
});

// ============================================================================
// getTotalTokens
// ============================================================================

test('getTotalTokens prefers the provider lump-sum total', t => {
	t.is(getTotalTokens({inputTokens: 100, outputTokens: 50, totalTokens: 160}), 160);
});

test('getTotalTokens sums input and output when total is missing', t => {
	t.is(getTotalTokens({inputTokens: 100, outputTokens: 50}), 150);
});

test('getTotalTokens uses whichever partial field is reported', t => {
	t.is(getTotalTokens({inputTokens: 100}), 100);
	t.is(getTotalTokens({outputTokens: 50}), 50);
	t.is(getTotalTokens({outputTokens: 50, cacheReadTokens: 100}), 150);
	t.is(getTotalTokens({inputTokens: 100, outputTokens: 50, totalTokens: 0}), 150);
});

test('getTotalTokens returns null when nothing usable is reported', t => {
	t.is(getTotalTokens({}), null);
	t.is(getTotalTokens({inputTokens: Number.NaN}), null);
});

// ============================================================================
// formatUsageIndicator
// ============================================================================

test('formatUsageIndicator renders tokens and cost', t => {
	t.is(
		formatUsageIndicator({inputTokens: 4100, outputTokens: 100, cost: 0.012}),
		'Tokens: 4.2k | ~$0.01',
	);
});

test('formatUsageIndicator renders sub-cent cost', t => {
	t.is(
		formatUsageIndicator({totalTokens: 900, cost: 0.0004}),
		'Tokens: 900 | <$0.01',
	);
});

test('formatUsageIndicator omits cost when unavailable or zero', t => {
	t.is(formatUsageIndicator({totalTokens: 4200}), 'Tokens: 4.2k');
	t.is(formatUsageIndicator({totalTokens: 4200, cost: 0}), 'Tokens: 4.2k');
});

test('formatUsageIndicator returns null without usable token counts', t => {
	t.is(formatUsageIndicator({}), null);
	t.is(formatUsageIndicator({cost: 0.5}), null);
});

test('formatUsageIndicator reports cached tokens when the provider read from cache', t => {
	t.is(
		formatUsageIndicator({
			inputTokens: 12_000,
			outputTokens: 400,
			cacheReadTokens: 9800,
			cost: 0.02,
		}),
		'Tokens: 12.4k | 9.8k cached | ~$0.02',
	);
});

test('formatUsageIndicator omits the cached segment when nothing was cached', t => {
	t.is(formatUsageIndicator({totalTokens: 4200}), 'Tokens: 4.2k');
	t.is(
		formatUsageIndicator({totalTokens: 4200, cacheReadTokens: 0}),
		'Tokens: 4.2k',
	);
});
