import test from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';
import {getBaseSystemPrompt, useChatHandler} from './useChatHandler';
import type {UseChatHandlerProps, ChatHandlerReturn} from './types';
import type {LLMClient, Message} from '../../types/core';
import {useUserMessageQueue} from '../useUserMessageQueue';

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
	abortController: null,
	setAbortController: () => {},
	...overrides,
});

const createMockClient = (): LLMClient => ({
	getCurrentModel: () => 'test-model',
	setModel: () => {},
	getContextSize: () => 0,
	getAvailableModels: async () => [],
	chat: async (_messages, _tools, callbacks) => {
		callbacks.onFinish?.();
		return {
			choices: [
				{
					message: {
						role: 'assistant',
						content: 'ok',
					},
				},
			],
		};
	},
	clearContext: async () => {},
	getTimeout: () => undefined,
});

const createMockToolManager = () => ({
	getAvailableToolNames: () => ['read_file'],
	getFilteredTools: () => ({}),
	getFilteredToolsForProvider: () => ({}),
}) as NonNullable<UseChatHandlerProps['toolManager']>;

const waitForCondition = async (
	condition: () => boolean,
	timeoutMs = 1000,
) => {
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		if (condition()) {
			return;
		}

		await new Promise(resolve => setTimeout(resolve, 25));
	}

	throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
};

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
	t.true('streamingReasoning' in hookResult!);
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
	t.is(typeof hookResult!.streamingReasoning, 'string');
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
	t.is(hookResult!.streamingReasoning, '');
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
	const modes: Array<'normal' | 'auto-accept' | 'yolo' | 'plan'> = ['normal', 'auto-accept', 'yolo', 'plan'];

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
	t.is(typeof props.onConversationComplete, 'function');
});

test('useChatHandler - drains queued message when setup fails before conversation loop', async t => {
	type QueueDrainHarnessResult = {
		chatHandler: ChatHandlerReturn;
		messageQueue: ReturnType<typeof useUserMessageQueue>;
		drainedMessages: string[];
	};

	let hookResult: QueueDrainHarnessResult | null = null;
	const throwingToolManager = {
		...createMockToolManager(),
		getToolNames: () => {
			throw new Error('command prompt failed');
		},
	} as NonNullable<UseChatHandlerProps['toolManager']>;
	const customCommandLoader = {
		findRelevantCommands: () => [],
	} as unknown as NonNullable<UseChatHandlerProps['customCommandLoader']>;

	function QueueDrainHarness({
		onResult,
	}: {
		onResult: (result: QueueDrainHarnessResult) => void;
	}) {
		const messageQueue = useUserMessageQueue();
		const drainedMessagesRef = React.useRef<string[]>([]);
		const chatHandler = useChatHandler(
			createMockProps({
				client: createMockClient(),
				toolManager: throwingToolManager,
				customCommandLoader,
				onConversationComplete: () => {
					void messageQueue.drainNextMessage(message => {
						drainedMessagesRef.current.push(message.message);
						return true;
					});
				},
			}),
		);

		React.useEffect(() => {
			onResult({
				chatHandler,
				messageQueue,
				drainedMessages: drainedMessagesRef.current,
			});
		}, [chatHandler, messageQueue, onResult]);

		return <></>;
	}

	const rendered = render(
		<QueueDrainHarness
			onResult={result => {
				hookResult = result;
			}}
		/>,
	);

	await waitForCondition(() => hookResult !== null);

	hookResult!.messageQueue.enqueueMessage({
		message: 'queued after failure',
		displayValue: 'Queued after failure',
	});

	await waitForCondition(() => hookResult!.messageQueue.queuedMessages.length === 1);

	await hookResult!.chatHandler.handleChatMessage('current turn');

	await waitForCondition(
		() => hookResult!.drainedMessages[0] === 'queued after failure',
	);
	await waitForCondition(() => hookResult!.messageQueue.queuedMessages.length === 0);

	t.deepEqual(hookResult!.drainedMessages, ['queued after failure']);
	t.is(hookResult!.messageQueue.queuedMessages.length, 0);
	rendered.unmount();
});

test('useChatHandler - injects project context from memory finder', async t => {
	let hookResult: ChatHandlerReturn | null = null;
	let sentMessages: Message[] = [];
	const client: LLMClient = {
		...createMockClient(),
		chat: async (messages, _tools, callbacks) => {
			sentMessages = messages;
			callbacks.onFinish?.();
			return {
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'ok',
						},
					},
				],
			};
		},
	};

	const props = createMockProps({
		client,
		toolManager: createMockToolManager(),
		memoryFinder: {
			findRelevantMemories: async (query, limit) => {
				t.is(query, 'refactor auth');
				t.is(limit, 8);
				return [
					{
						id: 'memory-1',
						content: 'Auth uses Clerk and avoids middleware.',
						category: 'architecture',
						timestamp: '2026-07-17T00:00:00.000Z',
					},
				];
			},
		},
	});

	const rendered = render(
		<TestHookComponent
			{...props}
			onResult={result => {
				hookResult = result;
			}}
		/>,
	);

	await waitForCondition(() => hookResult !== null);
	await hookResult!.handleChatMessage('refactor auth');

	t.true(sentMessages[0].content.includes('## Project Context'));
	t.true(
		sentMessages[0].content.includes(
			'- Auth uses Clerk and avoids middleware.',
		),
	);
	rendered.unmount();
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
		streamingReasoning: hookResult!.streamingReasoning,
		tokenCount: hookResult!.tokenCount,
	};

	t.is(typeof streamingState.isGenerating, 'boolean');
	t.is(typeof streamingState.streamingContent, 'string');
	t.is(typeof streamingState.streamingReasoning, 'string');
	t.is(typeof streamingState.tokenCount, 'number');
});

test('getBaseSystemPrompt - headless mode ignores cached prompt', t => {
	// Headless is the daemon's mode for triggered runs - it must rebuild the
	// system prompt each call so `Current Date:` reflects the trigger time
	// rather than whatever the interactive TUI cached at boot.
	const toolManager = {
		getAvailableToolNames: (_tune: unknown, mode: string) => [`tool-for-${mode}`],
	} as NonNullable<UseChatHandlerProps['toolManager']>;

	const result = getBaseSystemPrompt(
		'headless',
		'cached-prompt',
		toolManager,
		undefined,
		false,
	);

	t.not(result, 'cached-prompt');
	t.true(result.includes('Current Date:'));
});

test('getBaseSystemPrompt - normal mode reuses cached prompt', t => {
	const toolManager = {
		getAvailableToolNames: (_tune: unknown, mode: string) => [`tool-for-${mode}`],
	} as NonNullable<UseChatHandlerProps['toolManager']>;

	const result = getBaseSystemPrompt(
		'normal',
		'cached-prompt',
		toolManager,
		undefined,
		false,
	);

	t.is(result, 'cached-prompt');
});
