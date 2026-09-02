import test from 'ava';
import {cleanup, render} from 'ink-testing-library';
import React from 'react';
import {
	type PendingQuestion,
	signalQuestion,
} from '@/utils/question-queue';
import {
	type PendingToolApproval,
	signalToolApproval,
} from '@/utils/tool-approval-queue';
import {signalToolConfirm} from '@/utils/tool-confirm-queue';
import {useGlobalHandlerQueues} from './useGlobalHandlerQueues';

console.log('\nuseGlobalHandlerQueues.spec.tsx');

interface CallSpy<T extends unknown[] = unknown[]> {
	(...args: T): void;
	calls: T[];
}

function spy<T extends unknown[] = unknown[]>(): CallSpy<T> {
	const fn = ((...args: T) => {
		fn.calls.push(args);
	}) as CallSpy<T>;
	fn.calls = [];
	return fn;
}

let captured: ReturnType<typeof useGlobalHandlerQueues> | null = null;

function setup() {
	const setPendingQuestion = spy<[PendingQuestion | null]>();
	const setIsQuestionMode = spy<[boolean]>();

	function Probe() {
		captured = useGlobalHandlerQueues({
			setPendingQuestion,
			setIsQuestionMode,
		});
		return null;
	}

	const instance = render(<Probe />);
	if (!captured) throw new Error('hook did not initialize');
	return {
		hook: captured as ReturnType<typeof useGlobalHandlerQueues>,
		instance,
		setPendingQuestion,
		setIsQuestionMode,
	};
}

test.afterEach(() => {
	cleanup();
	captured = null;
});

test('returns the expected handler surface', t => {
	const {hook} = setup();

	t.is(typeof hook.handleQuestionAnswer, 'function');
	t.is(typeof hook.handleSubagentToolApproval, 'function');
	t.is(hook.pendingSubagentApproval, null);
});

test('signalQuestion drives setPendingQuestion + setIsQuestionMode', async t => {
	const {setPendingQuestion, setIsQuestionMode} = setup();

	const question: PendingQuestion = {
		question: 'What now?',
		options: ['a', 'b'],
		allowFreeform: false,
	};

	// Don't await — we want to see the side effects before resolving the answer.
	const answerPromise = signalQuestion(question);

	t.deepEqual(setPendingQuestion.calls, [[question]]);
	t.deepEqual(setIsQuestionMode.calls, [[true]]);

	captured!.handleQuestionAnswer('chosen-answer');

	const answer = await answerPromise;
	t.is(answer, 'chosen-answer');
});

test('handleQuestionAnswer clears pending question and exits question mode', async t => {
	const {setPendingQuestion, setIsQuestionMode} = setup();

	const promise = signalQuestion({
		question: 'q?',
		options: [],
		allowFreeform: true,
	});

	captured!.handleQuestionAnswer('done');
	await promise;

	t.deepEqual(setIsQuestionMode.calls, [[true], [false]]);
	t.deepEqual(setPendingQuestion.calls.at(-1), [null]);
});

test('handleQuestionAnswer with no pending question is safe to call', t => {
	const {hook, setIsQuestionMode, setPendingQuestion} = setup();

	hook.handleQuestionAnswer('orphan');

	t.deepEqual(setIsQuestionMode.calls, [[false]]);
	t.deepEqual(setPendingQuestion.calls, [[null]]);
});

test('signalToolApproval resolves true when approved', async t => {
	setup();

	const approval: PendingToolApproval = {
		toolName: 'execute_bash',
		args: {command: 'ls'},
	} as unknown as PendingToolApproval;

	const promise = signalToolApproval(approval);
	captured!.handleSubagentToolApproval(true);
	const result = await promise;
	t.true(result);
});

test('handleSubagentToolApproval resolves false on rejection', async t => {
	setup();

	const approval = {toolName: 'noop', args: {}} as unknown as PendingToolApproval;
	const promise = signalToolApproval(approval);

	captured!.handleSubagentToolApproval(false);
	const result = await promise;
	t.false(result);
});

test('handleSubagentToolApproval with no pending approval is a no-op', t => {
	const {hook} = setup();

	t.notThrows(() => hook.handleSubagentToolApproval(true));
});

// ---------------------------------------------------------------------------
// Concurrency: tool-executor starts up to MAX_CONCURRENT_AGENTS subagents in a
// single turn, so several callers can be waiting on one slot at once. Each must
// settle with its own answer — a caller that never settles hangs the turn,
// because the batch is awaited with Promise.allSettled.
// ---------------------------------------------------------------------------

function approvalFrom(subagentName: string): PendingToolApproval {
	return {
		toolCall: {id: subagentName, function: {name: 'write_file', arguments: {}}},
		subagentName,
	} as unknown as PendingToolApproval;
}

function question(text: string): PendingQuestion {
	return {question: text, options: [], allowFreeform: true};
}

test('concurrent subagent approvals each settle with their own answer', async t => {
	setup();

	const a = signalToolApproval(approvalFrom('agent-A'));
	const b = signalToolApproval(approvalFrom('agent-B'));
	const c = signalToolApproval(approvalFrom('agent-C'));

	captured!.handleSubagentToolApproval(true);
	captured!.handleSubagentToolApproval(false);
	captured!.handleSubagentToolApproval(true);

	t.deepEqual(await Promise.all([a, b, c]), [true, false, true]);
});

test('a queued request is presented only once the one before it is answered', async t => {
	const {setPendingQuestion, setIsQuestionMode} = setup();

	const first = question('first?');
	const second = question('second?');
	const firstAnswer = signalQuestion(first);
	const secondAnswer = signalQuestion(second);

	// Only the head is on screen; the second waits its turn.
	t.deepEqual(setPendingQuestion.calls, [[first]]);

	captured!.handleQuestionAnswer('a');
	t.deepEqual(setPendingQuestion.calls.at(-1), [second]);

	captured!.handleQuestionAnswer('b');
	t.deepEqual(setPendingQuestion.calls.at(-1), [null]);

	// Question mode stays on while the queue drains, and clears once it empties.
	t.deepEqual(setIsQuestionMode.calls, [[true], [true], [false]]);
	t.deepEqual(await Promise.all([firstAnswer, secondAnswer]), ['a', 'b']);
});

test('concurrent main-agent tool confirmations settle in arrival order', async t => {
	setup();

	const first = signalToolConfirm({
		toolCall: {id: '1', function: {name: 'write_file', arguments: {}}},
	} as unknown as Parameters<typeof signalToolConfirm>[0]);
	const second = signalToolConfirm({
		toolCall: {id: '2', function: {name: 'execute_bash', arguments: {}}},
	} as unknown as Parameters<typeof signalToolConfirm>[0]);

	captured!.handleToolConfirmation(false);
	captured!.handleToolConfirmation(true);

	t.deepEqual(await Promise.all([first, second]), [false, true]);
});
