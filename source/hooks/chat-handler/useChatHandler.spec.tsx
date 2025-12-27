import test from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';
import {useChatHandler} from './useChatHandler';
import type {UseChatHandlerProps, ChatHandlerReturn} from './types';
import type {Message} from '../../types/core';

// Test component that uses the hook and exposes results
function TestHookComponent(props: UseChatHandlerProps & {onResult?: (result: ChatHandlerReturn) => void}) {
	const {onResult, ...hookProps} = props;
	const result = useChatHandler(hookProps);

	React.useEffect(() => {
		onResult?.(result);
	}, [result, onResult]);

	return <></>;
}

// Helper to create mock props
const createMockProps = (overrides?: Partial<UseChatHandlerProps>): UseChatHandlerProps => ({
	client: null,
	toolManager: null,
	messages: [],
	setMessages: () => {},
	currentProvider: 'test-provider',
	currentModel: 'test-model',
	setIsCancelling: () => {},
	addToChatQueue: () => {},
	getNextComponentKey: () => 1,
	abortController: null,
	setAbortController: () => {},
	onStartToolConfirmationFlow: () => {},
	...overrides,
});

test('useChatHandler - returns correct interface', t => {
	let hookResult: ChatHandlerReturn | null = null;

	const props = createMockProps();

	render(
		<TestHookComponent
			{...props}
			onResult={result => {
				hookResult = result;
			}}
		/>,
	);

	// Verify the hook returned the expected interface
	t.truthy(hookResult);
	t.true('handleChatMessage' in hookResult!);
	t.true('processAssistantResponse' in hookResult!);
	t.true('isGenerating' in hookResult!);
	t.true('streamingContent' in hookResult!);
	t.true('tokenCount' in hookResult!);
});

test('useChatHandler - returns correct function types', t => {
	let hookResult: ChatHandlerReturn | null = null;

	const props = createMockProps();

	render(
		<TestHookComponent
			{...props}
			onResult={result => {
				hookResult = result;
			}}
		/>,
	);

	t.truthy(hookResult);
	t.is(typeof hookResult!.handleChatMessage, 'function');
	t.is(typeof hookResult!.processAssistantResponse, 'function');
	t.is(typeof hookResult!.isGenerating, 'boolean');
	t.is(typeof hookResult!.streamingContent, 'string');
	t.is(typeof hookResult!.tokenCount, 'number');
});

test('useChatHandler - initial streaming state is correct', t => {
	let hookResult: ChatHandlerReturn | null = null;

	const props = createMockProps();

	render(
		<TestHookComponent
			{...props}
			onResult={result => {
				hookResult = result;
			}}
		/>,
	);

	t.truthy(hookResult);
	t.is(hookResult!.isGenerating, false);
	t.is(hookResult!.streamingContent, '');
	t.is(hookResult!.tokenCount, 0);
});

test('useChatHandler - handles empty messages array', t => {
	let hookResult: ChatHandlerReturn | null = null;

	const props = createMockProps({
		messages: [],
	});

	t.notThrows(() => {
		render(
			<TestHookComponent
				{...props}
				onResult={result => {
					hookResult = result;
				}}
			/>,
		);
	});

	t.truthy(hookResult);
});

test('useChatHandler - handles messages with content', t => {
	let hookResult: ChatHandlerReturn | null = null;

	const messages: Message[] = [
		{role: 'user', content: 'test message'},
		{role: 'assistant', content: 'test response'},
	];

	const props = createMockProps({
		messages,
	});

	t.notThrows(() => {
		render(
			<TestHookComponent
				{...props}
				onResult={result => {
					hookResult = result;
				}}
			/>,
		);
	});

	t.truthy(hookResult);
});

test('useChatHandler - handles different development modes', t => {
	const modes: Array<'normal' | 'auto-accept' | 'plan'> = ['normal', 'auto-accept', 'plan'];

	for (const mode of modes) {
		let hookResult: ChatHandlerReturn | null = null;

		const props = createMockProps({
			developmentMode: mode,
		});

		t.notThrows(() => {
			render(
				<TestHookComponent
					{...props}
					onResult={result => {
						hookResult = result;
					}}
				/>,
			);
		}, `Should handle ${mode} mode`);

		t.truthy(hookResult);
	}
});

test('useChatHandler - handles non-interactive mode', t => {
	let hookResult: ChatHandlerReturn | null = null;

	const props = createMockProps({
		nonInteractiveMode: true,
	});

	t.notThrows(() => {
		render(
			<TestHookComponent
				{...props}
				onResult={result => {
					hookResult = result;
				}}
			/>,
		);
	});

	t.truthy(hookResult);
});

test('useChatHandler - accepts abort controller', t => {
	let hookResult: ChatHandlerReturn | null = null;

	const controller = new AbortController();
	const props = createMockProps({
		abortController: controller,
	});

	t.notThrows(() => {
		render(
			<TestHookComponent
				{...props}
				onResult={result => {
					hookResult = result;
				}}
			/>,
		);
	});

	t.truthy(hookResult);
});

test('useChatHandler - handles null client gracefully', t => {
	let hookResult: ChatHandlerReturn | null = null;

	const props = createMockProps({
		client: null,
		toolManager: null,
	});

	t.notThrows(() => {
		render(
			<TestHookComponent
				{...props}
				onResult={result => {
					hookResult = result;
				}}
			/>,
		);
	});

	t.truthy(hookResult);
});

test('useChatHandler - setMessages callback works', t => {
	let hookResult: ChatHandlerReturn | null = null;

	const messages: Message[] = [];
	const setMessages = (newMessages: Message[]) => {
		messages.length = 0;
		messages.push(...newMessages);
	};

	const props = createMockProps({
		messages,
		setMessages,
	});

	render(
		<TestHookComponent
			{...props}
			onResult={result => {
				hookResult = result;
			}}
		/>,
	);

	t.truthy(hookResult);

	// Test that setMessages works
	const newMessages: Message[] = [{role: 'user', content: 'test'}];
	props.setMessages(newMessages);

	t.is(messages.length, 1);
	t.is(messages[0].content, 'test');
});

test('useChatHandler - callbacks are provided', t => {
	let hookResult: ChatHandlerReturn | null = null;

	const props = createMockProps({
		onStartToolConfirmationFlow: () => {},
		onConversationComplete: () => {},
	});

	render(
		<TestHookComponent
			{...props}
			onResult={result => {
				hookResult = result;
			}}
		/>,
	);

	t.truthy(hookResult);
	// The hook should successfully initialize with callbacks
	t.is(typeof props.onStartToolConfirmationFlow, 'function');
	t.is(typeof props.onConversationComplete, 'function');
});

test('useChatHandler - streaming state types are correct', t => {
	let hookResult: ChatHandlerReturn | null = null;

	const props = createMockProps();

	render(
		<TestHookComponent
			{...props}
			onResult={result => {
				hookResult = result;
			}}
		/>,
	);

	t.truthy(hookResult);

	// Validate streaming state structure
	const streamingState = {
		isGenerating: hookResult!.isGenerating,
		streamingContent: hookResult!.streamingContent,
		tokenCount: hookResult!.tokenCount,
	};

	t.is(typeof streamingState.isGenerating, 'boolean');
	t.is(typeof streamingState.streamingContent, 'string');
	t.is(typeof streamingState.tokenCount, 'number');
});
