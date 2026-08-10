import test from 'ava';
import {buildResponseUsage} from './response-usage.js';

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
