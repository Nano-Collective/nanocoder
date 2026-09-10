import test from 'ava';
import type {Message, ToolCall} from '@/types/core';
import {
	createWalkthroughLifecycle,
	isInternalWalkthroughMessage,
	observeSuccessfulLifecycleTool,
	takeWalkthroughFallback,
} from './walkthrough-lifecycle';

const APPROVED: Message = {
	role: 'user',
	content:
		'The implementation plan below is approved.\n\n<approved_plan>Do it.</approved_plan>',
};
const DEGRADED_APPROVAL: Message = {
	role: 'user',
	content: 'The plan above is approved. Proceed with implementing it now.',
};
const ORDINARY: Message = {role: 'user', content: 'what does this file do?'};

const toolCall = (name: string): ToolCall => ({
	id: name,
	function: {name, arguments: {}},
});

test('a walkthrough is required only after approved-plan work', t => {
	t.true(createWalkthroughLifecycle([APPROVED]).required);
	t.true(createWalkthroughLifecycle([DEGRADED_APPROVAL]).required);
	t.false(createWalkthroughLifecycle([ORDINARY]).required);
	t.false(createWalkthroughLifecycle([]).required);
});

test('a later ordinary message ends the walkthrough obligation', t => {
	t.false(createWalkthroughLifecycle([APPROVED, ORDINARY]).required);
});

test('the internal nudge is ignored when finding the latest user message', t => {
	const lifecycle = createWalkthroughLifecycle([
		APPROVED,
		takeWalkthroughFallback(
			{required: true, written: false, fallbackAttempted: false},
			true,
		) as Message,
	]);
	t.true(lifecycle.required);
});

test('the nudge fires once and only when it can be satisfied', t => {
	const lifecycle = createWalkthroughLifecycle([APPROVED]);

	t.is(
		takeWalkthroughFallback(lifecycle, false),
		null,
		'no nudge when write_walkthrough is unavailable',
	);

	const nudge = takeWalkthroughFallback(lifecycle, true);
	t.truthy(nudge);
	t.true(isInternalWalkthroughMessage(nudge as Message));
	t.is(
		takeWalkthroughFallback(lifecycle, true),
		null,
		'the nudge is never repeated',
	);
});

test('a written walkthrough suppresses the nudge', t => {
	const lifecycle = createWalkthroughLifecycle([APPROVED]);
	observeSuccessfulLifecycleTool(lifecycle, toolCall('write_walkthrough'));
	t.true(lifecycle.written);
	t.is(takeWalkthroughFallback(lifecycle, true), null);
});

test('unrelated tools do not mark the walkthrough as written', t => {
	const lifecycle = createWalkthroughLifecycle([APPROVED]);
	observeSuccessfulLifecycleTool(lifecycle, toolCall('write_file'));
	t.false(lifecycle.written);
});

test('only the internal nudge is treated as internal', t => {
	t.false(isInternalWalkthroughMessage(APPROVED));
	t.false(isInternalWalkthroughMessage(ORDINARY));
	t.false(
		isInternalWalkthroughMessage({
			role: 'assistant',
			content: '<nanocoder-internal-walkthrough>',
		}),
	);
});
