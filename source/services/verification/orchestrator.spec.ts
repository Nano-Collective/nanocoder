import test from 'ava';
import type {VerificationRunResult} from './runner.js';
import {
	buildVerificationMessage,
	isVerificationMessage,
	resetVerificationLock,
	stripVerificationMessages,
	VerificationOrchestrator,
	type VerificationRunner,
	type VerificationSettings,
} from './orchestrator.js';

console.log(`\norchestrator.spec.ts`);

const SETTINGS: VerificationSettings = {
	command: ['check'],
	timeoutMs: 1000,
	maxOutputBytes: 4096,
	maxAttempts: 1,
	cwd: process.cwd(),
};

function passed(output = 'ok'): VerificationRunResult {
	return {
		status: 'passed',
		exitCode: 0,
		signal: null,
		durationMs: 5,
		output,
		truncated: false,
	};
}

function failed(output: string): VerificationRunResult {
	return {
		status: 'failed',
		exitCode: 1,
		signal: null,
		durationMs: 5,
		output,
		truncated: false,
	};
}

/** Replays a fixed script, one result per call, in order. */
function counting(
	results: VerificationRunResult[],
): VerificationRunner & {count: number} {
	let index = 0;
	const run = (async () => {
		const next = results[index++];
		if (!next) throw new Error('orchestrator ran more times than scripted');
		return next;
	}) as VerificationRunner & {count: number};
	return Object.defineProperty(run, 'count', {
		get: () => index,
	}) as VerificationRunner & {count: number};
}

test.beforeEach(() => {
	resetVerificationLock();
});

// ============================================================================
// Baseline
// ============================================================================

test.serial('baseline runs once however many times it is asked', async t => {
	const run = counting([passed()]);
	const orchestrator = new VerificationOrchestrator(SETTINGS, run);

	await orchestrator.ensureBaseline();
	await orchestrator.ensureBaseline();
	await orchestrator.ensureBaseline();

	t.is(run.count, 1);
});

test.serial('baseline is captured before the first edit and used for the diff', async t => {
	const run = counting([
		// The baseline: two tests already red before the agent started.
		failed('FAIL a.test.ts > one\nFAIL b.test.ts > two\n'),
		// After the edit: one of them is still red, one is new.
		failed('FAIL b.test.ts > two\nFAIL c.test.ts > three\n'),
	]);
	const orchestrator = new VerificationOrchestrator(
		{...SETTINGS, maxAttempts: 2},
		run,
	);

	await orchestrator.ensureBaseline();
	const outcome = await orchestrator.afterEdits();

	t.is(outcome.action, 'feedback');
	if (outcome.action !== 'feedback') return;
	t.true(outcome.decision.hasBaseline);
	// The pre-existing failure must not be reported as something the model did.
	t.deepEqual(
		outcome.decision.diff.introduced.map(f => f.line),
		['FAIL c.test.ts > three'],
	);
	t.deepEqual(
		outcome.decision.diff.persisting.map(f => f.line),
		['FAIL b.test.ts > two'],
	);
});

test.serial('a pre-existing failure with no baseline is still reported honestly', async t => {
	// No ensureBaseline call: the run failed before we could establish a
	// baseline, so the wording must not imply the model caused these.
	const run = counting([failed('FAIL a.test.ts > one\n')]);
	const orchestrator = new VerificationOrchestrator(
		{...SETTINGS, maxAttempts: 2},
		run,
	);

	const outcome = await orchestrator.afterEdits();
	t.is(outcome.action, 'feedback');
	if (outcome.action !== 'feedback') return;
	t.false(outcome.decision.hasBaseline);
	t.deepEqual(
		outcome.decision.diff.introduced.map(f => f.line),
		['FAIL a.test.ts > one'],
	);
	t.false(/introduced|your changes/i.test(outcome.text));
});

test.serial('invalidateBaseline lets a fresh baseline be taken', async t => {
	const run = counting([passed(), passed()]);
	const orchestrator = new VerificationOrchestrator(SETTINGS, run);

	await orchestrator.ensureBaseline();
	t.is(run.count, 1);
	orchestrator.invalidateBaseline();
	await orchestrator.ensureBaseline();
	t.is(run.count, 2);
});

// ============================================================================
// Attempt budget
// ============================================================================

test.serial('maxAttempts 1 reports and never asks for a fix', async t => {
	const run = counting([passed(), failed('FAIL a.test.ts > one\n')]);
	const orchestrator = new VerificationOrchestrator(
		{...SETTINGS, maxAttempts: 1},
		run,
	);

	await orchestrator.ensureBaseline();
	const outcome = await orchestrator.afterEdits();

	// The default has to be a dead end for the auto-fix path, not a slow walk
	// towards one.
	t.is(outcome.action, 'stopped');
	if (outcome.action !== 'stopped') return;
	t.is(outcome.reason, 'attempts-exhausted');
});

test.serial('a fix is re-checked until the budget is gone', async t => {
	// `maxAttempts: 3` means three post-edit runs, so the caller re-entering
	// after each `feedback` has to be able to spend the next one. Latching on
	// feedback would make every budget above 1 behave like 1.
	//
	// Each attempt fails on a strict subset of the previous one: a fix that
	// removes a failure without adding any. That clears the `no-progress` and
	// `regression` stops, so the only thing that can end the run is the budget
	// - which is exactly the thing under test.
	const run = counting([
		passed(),
		failed('FAIL a > one\nFAIL a > two\nFAIL a > three\n'),
		failed('FAIL a > two\nFAIL a > three\n'),
		failed('FAIL a > three\n'),
	]);
	const orchestrator = new VerificationOrchestrator(
		{...SETTINGS, maxAttempts: 3},
		run,
	);

	await orchestrator.ensureBaseline();
	const first = await orchestrator.afterEdits();
	t.is(first.action, 'feedback');

	const second = await orchestrator.afterEdits();
	t.is(second.action, 'feedback');

	const third = await orchestrator.afterEdits();
	t.is(third.action, 'stopped');
	if (third.action !== 'stopped') return;
	t.is(third.reason, 'attempts-exhausted');
	t.is(run.count, 4); // baseline + all three attempts, none wasted
});

test.serial('a passing run ends the loop successfully', async t => {
	const run = counting([passed(), passed()]);
	const orchestrator = new VerificationOrchestrator(SETTINGS, run);

	await orchestrator.ensureBaseline();
	const outcome = await orchestrator.afterEdits();

	t.is(outcome.action, 'passed');
});

test.serial('a pass is not re-run by a later edit in the same turn', async t => {
	const run = counting([passed(), passed()]);
	const orchestrator = new VerificationOrchestrator(
		{...SETTINGS, maxAttempts: 3},
		run,
	);

	await orchestrator.ensureBaseline();
	t.is((await orchestrator.afterEdits()).action, 'passed');

	// Settled on a pass: the turn already has its answer, and re-running would
	// charge the user for the same verdict.
	t.is((await orchestrator.afterEdits()).action, 'skipped');
	t.is(run.count, 2);
});

test.serial('a stop is not re-run by a later edit in the same turn', async t => {
	const run = counting([passed(), failed('FAIL a.test.ts > one\n')]);
	const orchestrator = new VerificationOrchestrator(
		{...SETTINGS, maxAttempts: 1},
		run,
	);

	await orchestrator.ensureBaseline();
	t.is((await orchestrator.afterEdits()).action, 'stopped');

	t.is((await orchestrator.afterEdits()).action, 'skipped');
	t.is(run.count, 2);
});

test.serial('a timeout stops rather than spending another attempt', async t => {
	const run = counting([
		{
			status: 'timeout',
			exitCode: null,
			signal: null,
			durationMs: 1000,
			output: '',
			truncated: false,
		},
	]);
	const orchestrator = new VerificationOrchestrator(
		{...SETTINGS, maxAttempts: 3},
		run,
	);

	const outcome = await orchestrator.afterEdits();
	t.is(outcome.action, 'stopped');
	if (outcome.action !== 'stopped') return;
	// Asking a model to fix a run that never finished produces invention.
	t.is(outcome.reason, 'timed-out');
});

test.serial('a missing command stops with the spawn error', async t => {
	const run = counting([
		{
			status: 'unavailable',
			exitCode: null,
			signal: null,
			durationMs: 1,
			output: '',
			truncated: false,
			spawnError: 'spawn check ENOENT',
		},
	]);
	const orchestrator = new VerificationOrchestrator(
		{...SETTINGS, maxAttempts: 3},
		run,
	);

	const outcome = await orchestrator.afterEdits();
	t.is(outcome.action, 'stopped');
	if (outcome.action !== 'stopped') return;
	t.is(outcome.reason, 'command-unavailable');
	t.regex(outcome.text, /ENOENT/);
});

test.serial('a throwing runner becomes an error outcome, not a crash', async t => {
	const run: VerificationRunner = async () => {
		throw new Error('spawn blew up');
	};
	const orchestrator = new VerificationOrchestrator(SETTINGS, run);

	const outcome = await orchestrator.afterEdits();
	t.is(outcome.action, 'error');
	if (outcome.action !== 'error') return;
	t.regex(outcome.message, /spawn blew up/);
});

test.serial('a throwing baseline is swallowed', async t => {
	const run: VerificationRunner = async () => {
		throw new Error('nope');
	};
	const orchestrator = new VerificationOrchestrator(SETTINGS, run);

	// The pre-edit hook must never be able to fail a turn.
	t.is(await orchestrator.ensureBaseline(), null);
});

// ============================================================================
// Concurrency
// ============================================================================

test.serial('a second orchestrator skips while a run is in flight', async t => {
	let release: (() => void) | null = null;
	const gate = new Promise<void>(resolve => {
		release = resolve;
	});
	const run: VerificationRunner = async () => {
		await gate;
		return passed();
	};

	const first = new VerificationOrchestrator(SETTINGS, run);
	const second = new VerificationOrchestrator(SETTINGS, run);

	const inFlightRun = first.afterEdits();
	// The window is synchronous only because the fake runner parks on `gate`;
	// a real child process holds `inFlight` for the whole run too.
	const concurrent = await second.afterEdits();
	release?.();
	await inFlightRun;

	t.is(concurrent.action, 'skipped');
	if (concurrent.action !== 'skipped') return;
	t.is(concurrent.reason, 'busy');
});

test.serial('the lock is released after a run, including a throwing one', async t => {
	const boom: VerificationRunner = async () => {
		throw new Error('x');
	};
	await new VerificationOrchestrator(SETTINGS, boom).afterEdits();

	// A lock leaked by the failure path would strand verification for the rest
	// of the session, silently.
	const outcome = await new VerificationOrchestrator(
		SETTINGS,
		async () => passed(),
	).afterEdits();
	t.is(outcome.action, 'passed');
});

// ============================================================================
// Message handling
// ============================================================================

test('a feedback message is recognisable and marked as a user turn', t => {
	const message = buildVerificationMessage('FAIL a.test.ts > one');
	// A synthetic assistant turn with tool calls and no results is rejected by
	// most providers; a user turn is not.
	t.is(message.role, 'user');
	t.true(isVerificationMessage(message));
});

test('superseded verification messages are stripped, others survive', t => {
	const messages = [
		{role: 'user', content: 'real question'},
		buildVerificationMessage('attempt 1'),
		{role: 'assistant', content: 'working on it'},
		buildVerificationMessage('attempt 2'),
	];

	const kept = stripVerificationMessages(messages);

	t.is(kept.length, 2);
	t.is(kept[0].content, 'real question');
	t.is(kept[1].role, 'assistant');
});

test('stripping returns the same array when there is nothing to strip', t => {
	const messages = [
		{role: 'user', content: 'real question'},
		{role: 'assistant', content: 'answer'},
	];
	// Identity matters: callers use this to decide whether to re-render.
	t.is(stripVerificationMessages(messages), messages);
});

test('a real user message that happens to mention verification is not stripped', t => {
	const messages = [
		{role: 'user', content: 'why is the verification command failing?'},
	];
	t.is(stripVerificationMessages(messages).length, 1);
});
