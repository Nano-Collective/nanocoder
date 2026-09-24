import test from 'ava';
import {
	autoCompactSessionOverrides,
	resetAutoCompactSession,
	setAutoCompactEnabled,
	setAutoCompactThreshold,
} from './auto-compact-session.js';
import {getSessionContextLimit, resetSessionContextLimit, setSessionContextLimit} from '@/models/index';
import {
	applyOnceOverrides,
	expandOverrideArgs,
	formatInlineToken,
	getOnceThreshold,
	isRecognizedOverrideKey,
	parseInlineOverrides,
} from './inline-overrides.js';

console.log('\ninline-overrides.spec.ts');

// ============================================================================
// parseInlineOverrides
// ============================================================================

test('parseInlineOverrides returns args unchanged when no overrides are present', t => {
	const {args, overrides} = parseInlineOverrides(['--preview', '--llm']);
	t.deepEqual(args, ['--preview', '--llm']);
	t.deepEqual(overrides, []);
});

test('parseInlineOverrides extracts a single key=value override', t => {
	const {args, overrides} = parseInlineOverrides(['?threshold=80']);
	t.deepEqual(args, []);
	t.deepEqual(overrides, [{key: 'threshold', value: '80'}]);
});

test('parseInlineOverrides mixes positional args and overrides', t => {
	const {args, overrides} = parseInlineOverrides([
		'--mechanical',
		'?threshold=80',
		'--preview',
	]);
	t.deepEqual(args, ['--mechanical', '--preview']);
	t.deepEqual(overrides, [{key: 'threshold', value: '80'}]);
});

test('parseInlineOverrides supports bare ?flag as a boolean override', t => {
	const {args, overrides} = parseInlineOverrides(['?preview', '--llm']);
	t.deepEqual(args, ['--llm']);
	t.deepEqual(overrides, [{key: 'preview', value: true}]);
});

test('parseInlineOverrides preserves values containing extra equals signs', t => {
	const {args, overrides} = parseInlineOverrides(['?config=key=value']);
	t.deepEqual(args, []);
	t.deepEqual(overrides, [{key: 'config', value: 'key=value'}]);
});

test('parseInlineOverrides accepts dotted, dashed, and underscored keys', t => {
	const {overrides} = parseInlineOverrides([
		'?auto_compact=on',
		'?compact-threshold=85',
		'?max.tokens=4096',
	]);
	t.deepEqual(overrides, [
		{key: 'auto_compact', value: 'on'},
		{key: 'compact-threshold', value: '85'},
		{key: 'max.tokens', value: '4096'},
	]);
});

test('parseInlineOverrides rejects invalid keys by leaving the token in args', t => {
	const {args, overrides} = parseInlineOverrides(['?1bad', '?']);
	t.deepEqual(args, ['?1bad', '?']);
	t.deepEqual(overrides, []);
});

test('parseInlineOverrides handles an empty args list', t => {
	const {args, overrides} = parseInlineOverrides([]);
	t.deepEqual(args, []);
	t.deepEqual(overrides, []);
});

// ============================================================================
// expandOverrideArgs
// ============================================================================

test('expandOverrideArgs expands recognised boolean flags to single tokens', t => {
	t.deepEqual(expandOverrideArgs([{key: 'preview', value: true}]), ['--preview']);
	t.deepEqual(expandOverrideArgs([{key: 'preview', value: false}]), []);
});

test('expandOverrideArgs maps truthy valued booleans to a single flag token', t => {
	t.deepEqual(expandOverrideArgs([{key: 'preview', value: 'yes'}]), [
		'--preview',
	]);
	t.deepEqual(expandOverrideArgs([{key: 'preview', value: 'on'}]), [
		'--preview',
	]);
	t.deepEqual(expandOverrideArgs([{key: 'preview', value: 'no'}]), []);
	t.deepEqual(expandOverrideArgs([{key: 'preview', value: 'off'}]), []);
});

test('expandOverrideArgs ignores unknown override keys', t => {
	t.deepEqual(
		expandOverrideArgs([{key: 'unknown', value: '42'}]),
		[],
	);
});

test('expandOverrideArgs preserves order', t => {
	t.deepEqual(
		expandOverrideArgs([
			{key: 'preview', value: true},
			{key: 'llm', value: true},
			{key: 'mechanical', value: true},
		]),
		['--preview', '--llm', '--mechanical'],
	);
});

// ============================================================================
// applyOnceOverrides - apply + restore round-trip
// ============================================================================

test.beforeEach(() => {
	// Wipe every store before each test so a leaked override cannot bleed
	// into a sibling case.
	resetAutoCompactSession();
	resetSessionContextLimit();
});

test('applyOnceOverrides - threshold override applies and restores the prior value', async t => {
	setAutoCompactThreshold(75);

	const restore = await applyOnceOverrides([{key: 'threshold', value: '85'}]);
	t.is(autoCompactSessionOverrides.threshold, 85, 'override is applied');

	restore();
	t.is(autoCompactSessionOverrides.threshold, 75, 'prior value is restored');
});

test('applyOnceOverrides - context-max override honours the k suffix and restores the prior value', async t => {
	setSessionContextLimit(8192);

	const restore = await applyOnceOverrides([
		{key: 'context-max', value: '128k'},
	]);
	t.is(getSessionContextLimit(), 128000, 'k suffix multiplies by 1000');

	restore();
	t.is(getSessionContextLimit(), 8192, 'prior value is restored');
});

test('applyOnceOverrides - auto-compact enabled override applies and restores the prior value', async t => {
	setAutoCompactEnabled(false);

	const restore = await applyOnceOverrides([
		{key: 'auto-compact', value: 'true'},
	]);
	t.is(autoCompactSessionOverrides.enabled, true, 'override is applied');

	restore();
	t.is(autoCompactSessionOverrides.enabled, false, 'prior value is restored');
});

test('applyOnceOverrides - restore when no prior override was set clears to null', async t => {
	t.is(autoCompactSessionOverrides.threshold, null);
	t.is(getSessionContextLimit(), null);

	const restore = await applyOnceOverrides([
		{key: 'threshold', value: '80'},
		{key: 'context-max', value: '128k'},
	]);
	t.is(autoCompactSessionOverrides.threshold, 80);
	t.is(getSessionContextLimit(), 128000);

	restore();
	t.is(autoCompactSessionOverrides.threshold, null, 'no prior → null after restore');
	t.is(getSessionContextLimit(), null, 'no prior → null after restore');
});

// ============================================================================
// applyOnceOverrides - best-effort validation (no apply, no restore, no error)
// ============================================================================

test('applyOnceOverrides returns a no-op restore when no overrides are present', async t => {
	const restore = await applyOnceOverrides([]);
	t.notThrows(() => restore());
	t.notThrows(() => restore());
});

test('applyOnceOverrides ignores unknown override keys', async t => {
	const restore = await applyOnceOverrides([{key: 'unknown', value: '1'}]);
	t.notThrows(() => restore());
});

test('applyOnceOverrides ignores threshold values that fail to parse', async t => {
	const restore = await applyOnceOverrides([{key: 'threshold', value: 'abc'}]);
	// No setter call was made, restore should still be a safe no-op.
	t.notThrows(() => restore());
});

test('applyOnceOverrides ignores context-max values that fail to parse', async t => {
	const restore = await applyOnceOverrides([
		{key: 'context-max', value: 'not-a-number'},
	]);
	t.notThrows(() => restore());
});

test('applyOnceOverrides ignores out-of-range threshold values', async t => {
	setAutoCompactThreshold(75);

	const restore = await applyOnceOverrides([{key: 'threshold', value: '40'}]);
	t.is(
		autoCompactSessionOverrides.threshold,
		75,
		'out-of-range threshold is skipped; prior value is preserved',
	);

	restore();
	t.is(
		autoCompactSessionOverrides.threshold,
		75,
		'no apply → no restore, prior value is still 75',
	);
});

// ============================================================================
// isRecognizedOverrideKey / formatInlineToken
// ============================================================================

test('isRecognizedOverrideKey accepts once-scoped settings and legacy flags', t => {
	for (const key of [
		'threshold',
		'auto-compact',
		'context-max',
		'preview',
		'llm',
		'mechanical',
		'aggressive',
		'conservative',
		'auto-on',
		'auto-off',
	]) {
		t.true(isRecognizedOverrideKey(key), `${key} is recognised`);
	}
});

test('isRecognizedOverrideKey rejects unknown keys', t => {
	for (const key of ['unknown', 'threshhold', 'config', 'once']) {
		t.false(isRecognizedOverrideKey(key), `${key} is not recognised`);
	}
});

test('formatInlineToken rebuilds the original ?token', t => {
	t.is(formatInlineToken({key: 'preview', value: true}), '?preview');
	t.is(formatInlineToken({key: 'threshold', value: '80'}), '?threshold=80');
	t.is(
		formatInlineToken({key: 'config', value: 'key=value'}),
		'?config=key=value',
	);
});

test('expandOverrideArgs forwards auto-on and auto-off to their --flags', t => {
	t.deepEqual(expandOverrideArgs([{key: 'auto-on', value: true}]), [
		'--auto-on',
	]);
	t.deepEqual(expandOverrideArgs([{key: 'auto-off', value: true}]), [
		'--auto-off',
	]);
});

// ============================================================================
// getOnceThreshold
// ============================================================================

test('getOnceThreshold returns undefined when no threshold override is present', t => {
	t.is(getOnceThreshold([]), undefined);
	t.is(getOnceThreshold([{key: 'context-max', value: '200k'}]), undefined);
});

test('getOnceThreshold parses and rounds a valid threshold', t => {
	t.is(getOnceThreshold([{key: 'threshold', value: '80'}]), 80);
});

test('getOnceThreshold lets the last valid threshold win', t => {
	t.is(
		getOnceThreshold([
			{key: 'threshold', value: '80'},
			{key: 'threshold', value: '90'},
		]),
		90,
	);
});

test('getOnceThreshold ignores unparseable and out-of-range values', t => {
	t.is(getOnceThreshold([{key: 'threshold', value: 'abc'}]), undefined);
	t.is(getOnceThreshold([{key: 'threshold', value: '40'}]), undefined);
	t.is(getOnceThreshold([{key: 'threshold', value: '99'}]), undefined);
});
