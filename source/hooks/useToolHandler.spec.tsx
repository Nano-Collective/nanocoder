import test from 'ava';
import {cleanup, render} from 'ink-testing-library';
import React from 'react';
import type {ConversationContext} from '@/hooks/useAppState';
import type {Message, ToolCall, ToolResult} from '@/types/core';
import {useToolHandler} from './useToolHandler';

console.log('\nuseToolHandler.spec.tsx');

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

interface ProbeProps {
	pendingToolCalls?: ToolCall[];
	currentToolIndex?: number;
	completedToolResults?: ToolResult[];
	currentConversationContext?: ConversationContext | null;
}

test.afterEach(() => {
	cleanup();
});

function makeToolCall(name = 'noop', id = 't1'): ToolCall {
	return {
		id,
		type: 'function',
		function: {
			name,
			arguments: '{}',
		},
	} as unknown as ToolCall;
}

function setup(probe: ProbeProps = {}) {
	const setPendingToolCalls = spy<[ToolCall[]]>();
	const setCurrentToolIndex = spy<[number]>();
	const setCompletedToolResults = spy<[ToolResult[]]>();
	const setCurrentConversationContext = spy<[ConversationContext | null]>();
	const setIsToolConfirmationMode = spy<[boolean]>();
	const setIsToolExecuting = spy<[boolean]>();
	const setMessages = spy<[Message[]]>();
	const addToChatQueue = spy<[React.ReactNode]>();
	const setLiveComponent = spy<[React.ReactNode]>();
	const resetToolConfirmationState = spy<[]>();
	const onProcessAssistantResponse = spy<[Message, Message[]]>();

	let captured: ReturnType<typeof useToolHandler> | null = null;

	function Probe() {
		captured = useToolHandler({
			pendingToolCalls: probe.pendingToolCalls ?? [],
			currentToolIndex: probe.currentToolIndex ?? 0,
			completedToolResults: probe.completedToolResults ?? [],
			currentConversationContext: probe.currentConversationContext ?? null,
			setPendingToolCalls,
			setCurrentToolIndex,
			setCompletedToolResults,
			setCurrentConversationContext,
			setIsToolConfirmationMode,
			setIsToolExecuting,
			setMessages,
			addToChatQueue,
			setLiveComponent,
			resetToolConfirmationState,
			onProcessAssistantResponse: async (sys, msgs) => {
				onProcessAssistantResponse(sys, msgs);
			},
		});
		return null;
	}

	render(<Probe />);

	if (!captured) {
		throw new Error('useToolHandler did not initialize');
	}

	return {
		handlers: captured as ReturnType<typeof useToolHandler>,
		setPendingToolCalls,
		setCurrentToolIndex,
		setCompletedToolResults,
		setCurrentConversationContext,
		setIsToolConfirmationMode,
		setIsToolExecuting,
		setMessages,
		addToChatQueue,
		setLiveComponent,
		resetToolConfirmationState,
		onProcessAssistantResponse,
	};
}

test('returns the expected handler surface', t => {
	const {handlers} = setup();

	t.is(typeof handlers.handleToolConfirmation, 'function');
	t.is(typeof handlers.handleToolConfirmationCancel, 'function');
	t.is(typeof handlers.startToolConfirmationFlow, 'function');
	t.is(typeof handlers.continueConversationWithToolResults, 'function');
	t.is(typeof handlers.executeCurrentTool, 'function');
});

test('startToolConfirmationFlow seeds all confirmation state', t => {
	const {
		handlers,
		setPendingToolCalls,
		setCurrentToolIndex,
		setCompletedToolResults,
		setCurrentConversationContext,
		setIsToolConfirmationMode,
	} = setup();

	const toolCalls = [makeToolCall('noop', 'a'), makeToolCall('noop', 'b')];
	const before: Message[] = [{role: 'user', content: 'hi'} as Message];
	const assistantMsg: Message = {
		role: 'assistant',
		content: 'using tools',
	} as Message;
	const systemMessage: Message = {role: 'system', content: 'sys'} as Message;

	handlers.startToolConfirmationFlow(toolCalls, before, assistantMsg, systemMessage);

	t.deepEqual(setPendingToolCalls.calls, [[toolCalls]]);
	t.deepEqual(setCurrentToolIndex.calls, [[0]]);
	t.deepEqual(setCompletedToolResults.calls, [[[]]]);
	t.is(setCurrentConversationContext.calls.length, 1);
	t.deepEqual(setCurrentConversationContext.calls[0]![0], {
		messagesBeforeToolExecution: before,
		assistantMsg,
		systemMessage,
	});
	t.deepEqual(setIsToolConfirmationMode.calls, [[true]]);
});

test('handleToolConfirmation(false) without context just resets', t => {
	const {
		handlers,
		resetToolConfirmationState,
		setMessages,
		addToChatQueue,
	} = setup({currentConversationContext: null});

	handlers.handleToolConfirmation(false);

	t.is(addToChatQueue.calls.length, 1);
	t.is(setMessages.calls.length, 0);
	t.is(resetToolConfirmationState.calls.length, 1);
});

test('handleToolConfirmation(false) with context records cancellations and resets', t => {
	const messagesBeforeToolExecution: Message[] = [
		{role: 'user', content: 'do it'} as Message,
	];
	const ctx: ConversationContext = {
		messagesBeforeToolExecution,
		assistantMsg: {role: 'assistant', content: 'using tools'} as Message,
		systemMessage: {role: 'system', content: 'sys'} as Message,
	};

	const {
		handlers,
		setMessages,
		resetToolConfirmationState,
		addToChatQueue,
	} = setup({
		pendingToolCalls: [makeToolCall('noop', 'a'), makeToolCall('noop', 'b')],
		currentConversationContext: ctx,
	});

	handlers.handleToolConfirmation(false);

	t.is(addToChatQueue.calls.length, 1);
	t.is(setMessages.calls.length, 1);
	t.is(resetToolConfirmationState.calls.length, 1);

	// Cancellation results should be appended to the messages before tool execution
	const updatedMessages = setMessages.calls[0]![0];
	t.true(updatedMessages.length > messagesBeforeToolExecution.length);
});

test('handleToolConfirmationCancel mirrors handleToolConfirmation(false) with context', t => {
	const ctx: ConversationContext = {
		messagesBeforeToolExecution: [{role: 'user', content: 'x'} as Message],
		assistantMsg: {role: 'assistant', content: 'y'} as Message,
		systemMessage: {role: 'system', content: 'z'} as Message,
	};

	const {handlers, setMessages, resetToolConfirmationState, addToChatQueue} =
		setup({
			pendingToolCalls: [makeToolCall()],
			currentConversationContext: ctx,
		});

	handlers.handleToolConfirmationCancel();

	t.is(addToChatQueue.calls.length, 1);
	t.is(setMessages.calls.length, 1);
	t.is(resetToolConfirmationState.calls.length, 1);
});

test('handleToolConfirmationCancel without context only resets', t => {
	const {handlers, setMessages, resetToolConfirmationState, addToChatQueue} =
		setup({currentConversationContext: null});

	handlers.handleToolConfirmationCancel();

	t.is(addToChatQueue.calls.length, 1);
	t.is(setMessages.calls.length, 0);
	t.is(resetToolConfirmationState.calls.length, 1);
});

test('continueConversationWithToolResults without context resets and bails', async t => {
	const {handlers, resetToolConfirmationState, onProcessAssistantResponse} =
		setup({currentConversationContext: null});

	await handlers.continueConversationWithToolResults([]);

	t.is(resetToolConfirmationState.calls.length, 1);
	t.is(onProcessAssistantResponse.calls.length, 0);
});

test('continueConversationWithToolResults forwards merged messages', async t => {
	const messagesBeforeToolExecution: Message[] = [
		{role: 'user', content: 'hello'} as Message,
	];
	const ctx: ConversationContext = {
		messagesBeforeToolExecution,
		assistantMsg: {role: 'assistant', content: 'thinking'} as Message,
		systemMessage: {role: 'system', content: 'sys-prompt'} as Message,
	};

	const {handlers, setMessages, onProcessAssistantResponse, resetToolConfirmationState} =
		setup({currentConversationContext: ctx});

	const toolResults: ToolResult[] = [
		{
			tool_call_id: 't1',
			role: 'tool',
			name: 'noop',
			content: 'ok',
		} as ToolResult,
	];

	await handlers.continueConversationWithToolResults(toolResults);

	t.is(setMessages.calls.length, 1);
	t.is(resetToolConfirmationState.calls.length, 1);
	t.is(onProcessAssistantResponse.calls.length, 1);
	t.is(onProcessAssistantResponse.calls[0]![0], ctx.systemMessage);
});

test('continueConversationWithToolResults uses completedToolResults when none passed', async t => {
	const ctx: ConversationContext = {
		messagesBeforeToolExecution: [{role: 'user', content: 'q'} as Message],
		assistantMsg: {role: 'assistant', content: 'a'} as Message,
		systemMessage: {role: 'system', content: 's'} as Message,
	};
	const completed: ToolResult[] = [
		{
			tool_call_id: 'cached',
			role: 'tool',
			name: 'noop',
			content: 'cached-result',
		} as ToolResult,
	];

	const {handlers, setMessages, onProcessAssistantResponse} = setup({
		currentConversationContext: ctx,
		completedToolResults: completed,
	});

	await handlers.continueConversationWithToolResults();

	t.is(setMessages.calls.length, 1);
	t.is(onProcessAssistantResponse.calls.length, 1);
});
