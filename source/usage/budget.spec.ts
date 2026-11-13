import test from 'ava';
import {
	BUDGET_EXCEEDED_EXIT_CODE,
	BUDGET_WARNING_PERCENT,
	BudgetTracker,
	formatBudgetSummary,
	isValidBudgetLimit,
	resolveBudgetLimits,
} from './budget.js';

// $1 per 1M input tokens, $2 per 1M output tokens.
const priced = async () => ({input: 1, output: 2});
const unpriced = async () => null;

test('tracker without limits always reports ok', async t => {
	const tracker = new BudgetTracker(
		{maxBudgetUsd: 100},
		'fake-model',
		priced,
	);
	const check = await tracker.recordResponse({
		inputTokens: 1_000_000,
		outputTokens: 1_000_000,
		totalTokens: 2_000_000,
	});
	t.is(check.status, 'ok');
	t.is(check.totals.totalTokens, 2_000_000);
	t.is(check.totals.totalCostUsd, 3);
});

test('tracker with no limits at all never prices and never trips', async t => {
	const tracker = new BudgetTracker({}, 'fake-model', priced);
	t.false(tracker.hasLimits());
	const check = await tracker.recordResponse({
		inputTokens: 1_000_000,
		outputTokens: 1_000_000,
		totalTokens: 2_000_000,
	});
	t.is(check.status, 'ok');
	t.is(check.totals.totalTokens, 2_000_000);
	// No USD limit configured, so no pricing lookup runs and cost stays unknown.
	t.is(check.totals.totalCostUsd, undefined);
});

test('token limit warns at 80% once and stops at 100%', async t => {
	t.is(BUDGET_WARNING_PERCENT, 80);
	const tracker = new BudgetTracker(
		{maxTokensTotal: 1000},
		'fake-model',
		priced,
	);
	t.true(tracker.hasLimits());

	let check = await tracker.recordResponse({totalTokens: 799});
	t.is(check.status, 'ok');

	check = await tracker.recordResponse({totalTokens: 1});
	t.is(check.status, 'warning');
	t.is(check.warnedLimit, 'tokens');
	t.is(check.totals.totalTokens, 800);

	// No second warning while still under the limit.
	check = await tracker.recordResponse({totalTokens: 199});
	t.is(check.status, 'ok');
	t.is(check.warnedLimit, null);

	check = await tracker.recordResponse({totalTokens: 1});
	t.is(check.status, 'exceeded');
	t.is(check.exceededLimit, 'tokens');
	t.is(check.totals.totalTokens, 1000);
	t.regex(
		tracker.formatExceededMessage(check),
		/token limit of 1,000 tokens/,
	);
});

test('token totals fall back to input + output when no total is reported', async t => {
	const tracker = new BudgetTracker(
		{maxTokensTotal: 1000},
		'fake-model',
		priced,
	);
	const check = await tracker.recordResponse({
		inputTokens: 500,
		outputTokens: 300,
	});
	t.is(check.totals.totalTokens, 800);
	t.is(check.status, 'warning');
});

test('USD limit warns at 80% and stops at 100% from priced usage', async t => {
	const tracker = new BudgetTracker({maxBudgetUsd: 1}, 'fake-model', priced);

	let check = await tracker.recordResponse({inputTokens: 400_000});
	t.is(check.status, 'ok');
	t.is(check.totals.totalCostUsd, 0.4);

	check = await tracker.recordResponse({inputTokens: 400_000});
	t.is(check.status, 'warning');
	t.is(check.warnedLimit, 'usd');
	t.is(check.totals.totalCostUsd, 0.8);

	check = await tracker.recordResponse({inputTokens: 400_000});
	t.is(check.status, 'exceeded');
	t.is(check.exceededLimit, 'usd');
	// 0.4 + 0.4 + 0.4 accumulates binary floating-point error; compare loosely.
	t.true(Math.abs((check.totals.totalCostUsd ?? 0) - 1.2) < 1e-9);
	t.regex(tracker.formatExceededMessage(check), /budget of \$1\.00/);
});

test('unpriced models fall back to the token limit only', async t => {
	const tracker = new BudgetTracker(
		{maxBudgetUsd: 1, maxTokensTotal: 1000},
		'local-model',
		unpriced,
	);
	const check = await tracker.recordResponse({inputTokens: 500});
	// 500 tokens at an unknown price must not trip the USD limit…
	t.is(check.status, 'ok');
	t.is(check.totals.costKnown, false);
	t.is(check.totals.totalCostUsd, undefined);
	// …but the summary says the cost is unknown instead of treating it as $0.
	t.regex(
		formatBudgetSummary(check.totals, check.limits, 'local-model'),
		/cost unknown for local-model/,
	);

	const exceeded = await tracker.recordResponse({totalTokens: 600});
	t.is(exceeded.status, 'exceeded');
	t.is(exceeded.exceededLimit, 'tokens');
});

test('responses with no usable usage leave totals untouched', async t => {
	const tracker = new BudgetTracker(
		{maxTokensTotal: 100},
		'fake-model',
		priced,
	);
	const check = await tracker.recordResponse(undefined);
	t.is(check.status, 'ok');
	t.is(check.totals.totalTokens, 0);
	const empty = await tracker.recordResponse({});
	t.is(empty.totals.totalTokens, 0);
});

test('grantContinueOnce lets exactly one more response through', async t => {
	const tracker = new BudgetTracker(
		{maxTokensTotal: 100},
		'fake-model',
		priced,
	);
	await tracker.recordResponse({totalTokens: 100});
	tracker.grantContinueOnce();
	const once = await tracker.recordResponse({totalTokens: 10});
	t.is(once.status, 'ok');
	const again = await tracker.recordResponse({totalTokens: 10});
	t.is(again.status, 'exceeded');
});

test('raiseLimits doubles the hit limit and re-arms its warning', async t => {
	const tracker = new BudgetTracker(
		{maxBudgetUsd: 1, maxTokensTotal: 2_000_000},
		'fake-model',
		priced,
	);
	await tracker.recordResponse({inputTokens: 1_000_000});
	const raised = tracker.raiseLimits();
	t.is(raised.maxBudgetUsd, 2);
	t.is(raised.maxTokensTotal, 2_000_000);
	// $1.00 of the new $2.00 limit is under the 80% warning line again.
	const check = await tracker.recordResponse({inputTokens: 100_000});
	t.is(check.status, 'ok');
	t.is(check.totals.totalCostUsd, 1.1);
});

test('setModel reprices later turns at the new model rates', async t => {
	const byModel = async (model: string) =>
		model === 'cheap' ? {input: 1, output: 1} : {input: 10, output: 10};
	const tracker = new BudgetTracker({maxBudgetUsd: 1}, 'cheap', byModel);
	await tracker.recordResponse({inputTokens: 100_000});
	t.is(tracker.getTotals().totalCostUsd, 0.1);
	tracker.setModel('pricey');
	const check = await tracker.recordResponse({inputTokens: 100_000});
	// 100k tokens at $10/1M = $1.00, taking the total to $1.10 — over the cap.
	t.is(check.status, 'exceeded');
	t.true(Math.abs((check.totals.totalCostUsd ?? 0) - 1.1) < 1e-9);
});

test('resolveBudgetLimits prefers CLI flags and scopes the USD setting', t => {
	const config = {perSessionUsd: 5, perRunUsd: 2, maxTokensTotal: 10_000};
	t.deepEqual(
		resolveBudgetLimits({config, scope: 'run'}),
		{maxBudgetUsd: 2, maxTokensTotal: 10_000},
	);
	t.deepEqual(resolveBudgetLimits({config, scope: 'session'}), {
		maxBudgetUsd: 5,
		maxTokensTotal: 10_000,
	});
	t.deepEqual(
		resolveBudgetLimits({
			cli: {maxBudgetUsd: 0.5},
			config,
			scope: 'run',
		}),
		{maxBudgetUsd: 0.5, maxTokensTotal: 10_000},
	);
});

test('resolveBudgetLimits drops non-positive limits', t => {
	t.deepEqual(
		resolveBudgetLimits({
			cli: {maxBudgetUsd: 0, maxTokensTotal: -5},
			config: {perRunUsd: Number.NaN},
			scope: 'run',
		}),
		{},
	);
	t.false(isValidBudgetLimit(0));
	t.false(isValidBudgetLimit(-1));
	t.false(isValidBudgetLimit(Number.NaN));
	t.true(isValidBudgetLimit(0.01));
});

test('formatBudgetSummary reports both limits and the no-limit case', t => {
	t.is(
		formatBudgetSummary(
			{totalTokens: 45_200, totalCostUsd: 1.23, costKnown: true},
			{maxBudgetUsd: 2, maxTokensTotal: 100_000},
		),
		'$1.23 of $2.00 (62%) · 45,200 of 100,000 tokens (45%)',
	);
	t.is(
		formatBudgetSummary(
			{totalTokens: 10, totalCostUsd: undefined, costKnown: false},
			{},
		),
		'no budget limit set',
	);
});

test('budget-exceeded exit code is distinct from the other plain-shell codes', t => {
	// Plain shell: 0 success, 1 error, 2 tool-approval-required.
	t.not(BUDGET_EXCEEDED_EXIT_CODE, 0);
	t.not(BUDGET_EXCEEDED_EXIT_CODE, 1);
	t.not(BUDGET_EXCEEDED_EXIT_CODE, 2);
	t.is(BUDGET_EXCEEDED_EXIT_CODE, 3);
});
