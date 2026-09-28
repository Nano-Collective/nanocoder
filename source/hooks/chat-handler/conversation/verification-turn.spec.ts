import test from 'ava';
import {
	postEditHook,
	preEditHook,
	prepareForVerificationInstruction,
	turnEditedFiles,
	turnEditedFilesSuccessfully,
} from './verification-turn';
import {VerificationOrchestrator, type VerificationRunner} from '@/services/verification/orchestrator';
import type {Message, ToolCall, ToolResult} from '@/types/core';

console.log(`\nverification-turn.spec.ts`);

const SETTINGS = {
	command: ['check'],
	timeoutMs: 1000,
	maxOutputBytes: 4096,
	maxAttempts: 1,
	cwd: process.cwd(),
};

function passed(output = 'ok') {
	return {
		status: 'passed' as const,
		exitCode: 0,
		signal: null,
		durationMs: 5,
		output,
		truncated: false,
	};
}

function failed(output: string) {
	return {
		status: 'failed' as const,
		exitCode: 1,
		signal: null,
		durationMs: 5,
		output,
		truncated: false,
	};
}

function turnWith(
	results: ReturnType<typeof passed>[],
	maxAttempts = 1,
) {
	const queue = [...results];
	let index = 0;
	const run: VerificationRunner = async () => {
		const next = queue[index++];
		if (!next) throw new Error('ran more times than scripted');
		return next;
	};
	return {orchestrator: new VerificationOrchestrator({...SETTINGS, maxAttempts}, run)};
}

function call(name: string): ToolCall {
	return {id: `c-${name}`, function: {name, arguments: {}}};
}

function result(name: string, isError: boolean): ToolResult {
	return {
		role: 'tool',
		tool_call_id: `c-${name}`,
		name,
		content: isError ? 'rejected' : 'written',
		isError,
	} as unknown as ToolResult;
}

// ============================================================================
// Edit detection
// ============================================================================

test('content-editing tools count as edits', t => {
	for (const name of ['write_file', 'string_replace', 'diff_edit']) {
		t.true(turnEditedFiles([call(name)]), `${name} should count as an edit`);
	}
});

test('read-only and non-content tools do not', t => {
	for (const name of [
		'read_file',
		'list_directory',
		'execute_bash',
		'file_op', // delete/move/copy/mkdir mutate the tree but not content
		'lsp_get_diagnostics',
	]) {
		t.false(turnEditedFiles([call(name)]), `${name} should not count`);
	}
});

test('a mixed turn counts as an edit', t => {
	t.true(turnEditedFiles([call('read_file'), call('write_file')]));
});

test('an edit that failed does not count', t => {
	// The tree is byte-identical after a rejected write, so running the check
	// here would report a pre-existing failure as freshly introduced.
	t.false(
		turnEditedFilesSuccessfully(
			[call('write_file')],
			[result('write_file', true)],
		),
	);
});

test('a failed edit does not mask a successful one in the same turn', t => {
	t.true(
		turnEditedFilesSuccessfully(
			[call('string_replace'), call('write_file')],
			[result('string_replace', true), result('write_file', false)],
		),
	);
});

test('a successful non-edit tool does not make a turn an edit', t => {
	t.false(
		turnEditedFilesSuccessfully(
			[call('read_file')],
			[result('read_file', false)],
		),
	);
});

test('no results yet falls back to the attempted calls', t => {
	t.true(turnEditedFilesSuccessfully([call('write_file')], undefined));
});

// ============================================================================
// Pre-edit hook
// ============================================================================

test('preEditHook takes a baseline before the first edit', async t => {
	const turn = turnWith([passed(), failed('FAIL a.test.ts > one\n')]);
	await preEditHook(turn, [call('write_file')]);
	t.true(turn.orchestrator.hasBaselineRun);
});

test('preEditHook is skipped when the turn edits nothing', async t => {
	const turn = turnWith([passed()]);
	await preEditHook(turn, [call('read_file')]);
	// A baseline costs a full run of the check; paying it for a turn that only
	// read files is pure waste.
	t.false(turn.orchestrator.hasBaselineRun);
});

test('preEditHook without a turn is a no-op', async t => {
	await t.notThrowsAsync(preEditHook(undefined, [call('write_file')]));
	await t.notThrowsAsync(preEditHook(null as never, [call('write_file')]));
});

test('preEditHook runs at most once across many edits', async t => {
	const turn = turnWith([passed(), passed()]);
	await preEditHook(turn, [call('write_file')]);
	await preEditHook(turn, [call('string_replace')]);
	await preEditHook(turn, [call('diff_edit')]);
	// Two results scripted; a third run would have thrown.
	t.true(turn.orchestrator.hasBaselineRun);
});

// ============================================================================
// Post-edit hook
// ============================================================================

test('postEditHook reports a pass without involving the model', async t => {
	const turn = turnWith([passed(), passed()]);
	await preEditHook(turn, [call('write_file')]);

	const result = await postEditHook(turn, true);
	t.is(result.kind, 'report');
	if (result.kind !== 'report') return;
	t.is(result.status, 'passed');
});

test('postEditHook asks the model to fix a failure when budget remains', async t => {
	const turn = turnWith(
		[passed(), failed('FAIL a.test.ts > one\n')],
		2,
	);
	await preEditHook(turn, [call('write_file')]);

	const result = await postEditHook(turn, true);
	t.is(result.kind, 'instruct');
	if (result.kind !== 'instruct') return;
	// Provider-safe: a user turn, not a synthetic assistant turn with tool calls.
	t.is(result.message.role, 'user');
	t.regex(result.message.content, /FAIL a\.test\.ts/);
});

test('postEditHook with the default budget reports rather than instructs', async t => {
	const turn = turnWith([passed(), failed('FAIL a.test.ts > one\n')]);
	await preEditHook(turn, [call('write_file')]);

	const result = await postEditHook(turn, true);
	// maxAttempts defaults to 1. The safe default must be a dead end for the
	// auto-fix path, not a slow walk towards one.
	t.is(result.kind, 'report');
	if (result.kind !== 'report') return;
	t.is(result.status, 'attempts-exhausted');
});

test('postEditHook stays silent when nothing was edited', async t => {
	const turn = turnWith([passed(), passed()]);
	const result = await postEditHook(turn, false);
	t.is(result.kind, 'none');
});

test('postEditHook stays silent without a turn', async t => {
	t.is((await postEditHook(undefined, true)).kind, 'none');
});

test('postEditHook reports a stop as user text, never as an instruction', async t => {
	const turn = turnWith([
		{
			status: 'unavailable' as const,
			exitCode: null,
			signal: null,
			durationMs: 1,
			output: '',
			truncated: false,
			spawnError: 'spawn check ENOENT',
		},
	]);
	const result = await postEditHook(turn, true);
	// A model told "the loop gave up" tends to try anyway.
	t.is(result.kind, 'report');
	if (result.kind !== 'report') return;
	t.regex(result.text, /ENOENT/);
});

// ============================================================================
// Context safety
// ============================================================================

test('a new instruction replaces the previous one', t => {
	const previous: Message = {
		role: 'user',
		content:
			'The verification command failed after your edits. attempt 1 output...',
	};
	const messages: Message[] = [
		{role: 'user', content: 'please fix the login bug'},
		{role: 'assistant', content: 'on it'},
		previous,
	];
	const fresh = prepareForVerificationInstruction(messages, {
		role: 'user',
		content: 'The verification command failed after your edits. attempt 2',
	});

	t.is(fresh.length, 3);
	t.false(
		fresh.some(message => message.content === previous.content),
		'the superseded instruction should be gone',
	);
	t.is(fresh[2].content.includes('attempt 2'), true);
	// The real conversation is untouched.
	t.is(fresh[0].content, 'please fix the login bug');
});

test('the original array is not mutated', t => {
	const messages: Message[] = [{role: 'user', content: 'hi'}];
	const out = prepareForVerificationInstruction(messages, {
		role: 'user',
		content: 'x',
	});
	t.is(messages.length, 1);
	t.is(out.length, 2);
});
