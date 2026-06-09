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
