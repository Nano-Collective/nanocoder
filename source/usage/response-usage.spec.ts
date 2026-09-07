import test from 'ava';
import {
	buildResponseUsage,
	buildResponseUsageBounded,
	priceTokens,
} from './response-usage.js';

console.log('\nresponse-usage.spec.ts');

// Pricing stub: $3 / 1M input, $15 / 1M output
const stubPricing = async () => ({input: 3, output: 15});
const noPricing = async () => null;
const failingPricing = async (): Promise<null> => {
	throw new Error('lookup failed');
};

test('buildResponseUsage returns undefined when the provider reported nothing', async t => {
	t.is(await buildResponseUsage(undefined, 'model', stubPricing), undefined);
	t.is(await buildResponseUsage({}, 'model', stubPricing), undefined);
	t.is(
		await buildResponseUsage({inputTokens: Number.NaN}, 'model', stubPricing),
		undefined,
	);
});

test('buildResponseUsage computes cost from input and output tokens', async t => {
	const result = await buildResponseUsage(
		{inputTokens: 1_000_000, outputTokens: 100_000},
		'model',
		stubPricing,
	);
	t.truthy(result);
	t.is(result?.inputTokens, 1_000_000);
	t.is(result?.outputTokens, 100_000);
	// 1M * $3/1M + 0.1M * $15/1M = $4.50
	t.is(result?.cost, 4.5);
});

test('buildResponseUsage prices cached input with cache-specific rates', async t => {
	const result = await buildResponseUsage(
		{
			inputTokens: 1_000_000,
			outputTokens: 100_000,
			totalTokens: 1_100_000,
			cacheReadTokens: 500_000,
			cacheWriteTokens: 100_000,
		},
		'model',
		async () => ({
			input: 3,
			output: 15,
			cache_read: 0.3,
			cache_write: 0.6,
		}),
	);

	t.is(result?.cacheReadTokens, 500_000);
	t.is(result?.cacheWriteTokens, 100_000);
	t.is(result?.cost, 2.91);
});

test('buildResponseUsage falls back to input pricing when cache rates are absent', async t => {
	const result = await buildResponseUsage(
		{
			inputTokens: 1_000_000,
			outputTokens: 100_000,
			totalTokens: 1_100_000,
			cacheReadTokens: 500_000,
		},
		'model',
		stubPricing,
	);

	// The 500k cached tokens use the normal $3 input rate when no cache rate
	// is available, so no input tokens disappear from the estimate.
	t.is(result?.cost, 4.5);
});

test('buildResponseUsage prices zero-filled input/output with a positive total as a lump sum', async t => {
	// Regression: accumulators that zero-fill unreported input/output must
	// not route a total-only report into the input/output branch (cost $0).
	const result = await buildResponseUsage(
		{inputTokens: 0, outputTokens: 0, totalTokens: 1_000_000},
		'model',
		stubPricing,
	);
	// (3 + 15) / 2 = $9 per 1M
	t.is(result?.cost, 9);
});

test('buildResponseUsage still prices a genuine zero-usage report as zero', async t => {
	const result = await buildResponseUsage(
		{inputTokens: 0, outputTokens: 0, totalTokens: 0},
		'model',
		stubPricing,
	);
	t.is(result?.cost, 0);
});

test('buildResponseUsage averages rates for lump-sum totals', async t => {
	const result = await buildResponseUsage(
		{totalTokens: 1_000_000},
		'model',
		stubPricing,
	);
	// (3 + 15) / 2 = $9 per 1M
	t.is(result?.cost, 9);
});

test('buildResponseUsage omits cost when pricing is unavailable', async t => {
	const result = await buildResponseUsage(
		{inputTokens: 100, outputTokens: 50},
		'local-model',
		noPricing,
	);
	t.truthy(result);
	t.is(result?.cost, undefined);
	t.is(result?.inputTokens, 100);
});

test('buildResponseUsage swallows pricing lookup failures', async t => {
	const result = await buildResponseUsage(
		{inputTokens: 100, outputTokens: 50},
		'model',
		failingPricing,
	);
	t.truthy(result);
	t.is(result?.cost, undefined);
});

// ============================================================================
// buildResponseUsageBounded
// ============================================================================

test('buildResponseUsageBounded includes cost when pricing resolves in time', async t => {
	const result = await buildResponseUsageBounded(
		{inputTokens: 1_000_000, outputTokens: 100_000},
		'model',
		{timeoutMs: 1000, getPricing: stubPricing},
	);
	t.is(result?.cost, 4.5);
});

test('buildResponseUsageBounded returns tokens-only when the lookup exceeds the ceiling', async t => {
	// A lookup that never resolves within the test — simulates a cold or
	// offline models.dev fetch holding the promise open.
	const hangingPricing = () =>
		new Promise<{input: number; output: number} | null>(() => {});

	const result = await buildResponseUsageBounded(
		{inputTokens: 4100, outputTokens: 100},
		'model',
		{timeoutMs: 10, getPricing: hangingPricing},
	);
	t.truthy(result);
	t.is(result?.inputTokens, 4100);
	t.is(result?.outputTokens, 100);
	t.is(result?.cost, undefined);
});

test('buildResponseUsageBounded returns undefined when the provider reported nothing', async t => {
	t.is(
		await buildResponseUsageBounded(undefined, 'model', {
			timeoutMs: 10,
			getPricing: stubPricing,
		}),
		undefined,
	);
	t.is(
		await buildResponseUsageBounded({}, 'model', {
			timeoutMs: 10,
			getPricing: stubPricing,
		}),
		undefined,
	);
});

const cachePricing = async () => ({
	input: 3,
	output: 15,
	cache_read: 0.3,
	cache_write: 3.75,
});

test('priceTokens matches the plain input/output rate when no cache tokens are reported', t => {
	t.is(
		priceTokens(
			{input: 3, output: 15},
			{inputTokens: 1_000_000, outputTokens: 100_000},
		),
		4.5,
	);
});

test('priceTokens bills cache reads at the discounted rate', t => {
	t.is(
		priceTokens(
			{input: 3, output: 15, cache_read: 0.3, cache_write: 3.75},
			{inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 800_000},
		),
		0.84,
	);
});

test('priceTokens bills cache writes at the premium rate', t => {
	t.is(
		priceTokens(
			{input: 3, output: 15, cache_read: 0.3, cache_write: 3.75},
			{inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 800_000},
		),
		3.6,
	);
});

test('priceTokens falls back to the input rate when cache pricing is unknown', t => {
	t.is(
		priceTokens(
			{input: 3, output: 15},
			{
				inputTokens: 1_000_000,
				outputTokens: 0,
				cacheReadTokens: 500_000,
				cacheWriteTokens: 250_000,
			},
		),
		3,
	);
});

test('priceTokens never charges negative uncached input', t => {
	t.is(
		priceTokens(
			{input: 3, output: 15, cache_read: 0.3},
			{inputTokens: 1000, outputTokens: 0, cacheReadTokens: 5000},
		),
		0.0015,
	);
});

test('priceTokens treats missing token fields as zero', t => {
	t.is(priceTokens({input: 3, output: 15}, {}), 0);
});

test('buildResponseUsage prices a cache hit below the uncached equivalent', async t => {
	const cached = await buildResponseUsage(
		{
			inputTokens: 1_000_000,
			outputTokens: 100_000,
			cacheReadTokens: 900_000,
		},
		'model',
		cachePricing,
	);
	const uncached = await buildResponseUsage(
		{inputTokens: 1_000_000, outputTokens: 100_000},
		'model',
		cachePricing,
	);
	t.true((cached?.cost as number) < (uncached?.cost as number));
	t.is(cached?.cost, 2.07);
});

test('buildResponseUsage surfaces the cache token counts', async t => {
	const result = await buildResponseUsage(
		{
			inputTokens: 5000,
			outputTokens: 100,
			cacheReadTokens: 4000,
			cacheWriteTokens: 500,
		},
		'model',
		cachePricing,
	);
	t.is(result?.cacheReadTokens, 4000);
	t.is(result?.cacheWriteTokens, 500);
});

test('buildResponseUsage leaves non-caching reports byte-identical to before', async t => {
	const result = await buildResponseUsage(
		{inputTokens: 1_000_000, outputTokens: 100_000},
		'model',
		stubPricing,
	);
	t.is(result?.cost, 4.5);
	t.is(result?.cacheReadTokens, undefined);
	t.is(result?.cacheWriteTokens, undefined);
});
