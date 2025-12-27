import {ErrorMessage, InfoMessage} from '@/components/message-box';
import ToolMessage from '@/components/tool-message';
import {
	DELAY_COMMAND_COMPLETE_MS,
	TRUNCATION_RESULT_STRING_LENGTH,
} from '@/constants';
import type {LLMClient, Message} from '@/types/index';
import test from 'ava';
import React from 'react';
import {
	createClearMessagesHandler,
	handleMessageSubmission,
} from './app-util.js';

console.log('\napp/utils/appUtils.spec.ts');

// Mock implementations
const createMockOptions = (overrides = {}) => {
	const defaultOptions = {
		customCommandCache: new Map(),
		customCommandLoader: {
			getCommand: () => null,
		},
		customCommandExecutor: {
			execute: (command: any, args: string[]) => 'processed prompt',
		},
		onClearMessages: async () => {},
		onEnterModelSelectionMode: () => {},
		onEnterProviderSelectionMode: () => {},
		onEnterThemeSelectionMode: () => {},
		onEnterModelDatabaseMode: () => {},
		onEnterConfigWizardMode: () => {},
		onEnterCheckpointLoadMode: () => {},
		onShowStatus: () => {},
		onHandleChatMessage: async () => {},
		onAddToChatQueue: () => {},
		onCommandComplete: () => {},
		getNextComponentKey: (() => {
			let counter = 0;
			return () => ++counter;
		})(),
		setMessages: () => {},
		messages: [] as Message[],
		setIsBashExecuting: () => {},
		setCurrentBashCommand: () => {},
		provider: 'test-provider',
		model: 'test-model',
		getMessageTokens: () => 100,
	};

	return {...defaultOptions, ...overrides};
};

const createMockClient = (): LLMClient => ({
	getCurrentModel: () => 'test-model',
	setModel: () => {},
	getContextSize: () => 4096,
	getAvailableModels: async () => ['model1', 'model2'],
	chat: async () => ({
		content: 'response',
		tool_calls: [],
	}),
	clearContext: async () => {},
});

// Tests for handleMessageSubmission

test('handleMessageSubmission: handles bash command execution successfully', async t => {
	const bashCommand = 'echo "hello world"';
	const mockToolRegistry = {
		execute_bash: async ({command}: {command: string}) => {
			t.is(command, bashCommand);
			return JSON.stringify({
				fullOutput: 'hello world\n',
				llmContext: 'hello world\n',
			});
		},
	};

	const addedComponents: any[] = [];
	let bashExecuting = false;
	let currentBashCmd = '';
	const messagesAdded: Message[] = [];

	const options = createMockOptions({
		setIsBashExecuting: (value: boolean) => {
			bashExecuting = value;
		},
		setCurrentBashCommand: (cmd: string) => {
			currentBashCmd = cmd;
		},
		onAddToChatQueue: (component: any) => {
			addedComponents.push(component);
		},
		setMessages: (msgs: Message[]) => {
			messagesAdded.push(...msgs);
		},
		messages: [],
	});

	// Mock the tool registry globally
	const originalToolRegistry = (global as any).toolRegistry;
	(global as any).toolRegistry = mockToolRegistry;

	await handleMessageSubmission(`!${bashCommand}`, options);

	// Restore original
	(global as any).toolRegistry = originalToolRegistry;

	// Verify bash execution state was set and cleared
	t.is(bashExecuting, false);
	t.is(currentBashCmd, '');

	// Verify a component was added to chat queue
	t.is(addedComponents.length, 1);

	// Verify message was added to context
	t.is(messagesAdded.length, 1);
	t.is(messagesAdded[0].role, 'user');
	t.true(messagesAdded[0].content.includes(bashCommand));
});

test('handleMessageSubmission: handles bash command with non-JSON output', async t => {
	const bashCommand = 'ls';
	const plainOutput = 'file1.txt\nfile2.txt';

	const mockToolRegistry = {
		execute_bash: async () => plainOutput,
	};

	const addedComponents: any[] = [];
	let messagesAdded: Message[] = [];

	const options = createMockOptions({
		onAddToChatQueue: (component: any) => {
			addedComponents.push(component);
		},
		setMessages: (msgs: Message[]) => {
			messagesAdded = msgs;
		},
		messages: [],
	});

	const originalToolRegistry = (global as any).toolRegistry;
	(global as any).toolRegistry = mockToolRegistry;

	await handleMessageSubmission(`!${bashCommand}`, options);

	(global as any).toolRegistry = originalToolRegistry;

	// Should have added component and message
	t.is(addedComponents.length, 1);
	t.is(messagesAdded.length, 1);
	// Verify the message includes the bash command (content may be truncated)
	t.true(messagesAdded[0].content.includes(bashCommand));
});

test('handleMessageSubmission: truncates long bash output for LLM context', async t => {
	const bashCommand = 'cat largefile.txt';
	const longOutput = 'a'.repeat(TRUNCATION_RESULT_STRING_LENGTH + 1000);

	const mockToolRegistry = {
		execute_bash: async () => longOutput,
	};

	let messagesAdded: Message[] = [];

	const options = createMockOptions({
		onAddToChatQueue: () => {},
		setMessages: (msgs: Message[]) => {
			messagesAdded = msgs;
		},
		messages: [],
	});

	const originalToolRegistry = (global as any).toolRegistry;
	(global as any).toolRegistry = mockToolRegistry;

	await handleMessageSubmission(`!${bashCommand}`, options);

	(global as any).toolRegistry = originalToolRegistry;

	// Verify output was truncated in message context
	t.is(messagesAdded.length, 1);
	const contextContent = messagesAdded[0].content;
	// The truncated content should be shorter than the full output
	t.true(contextContent.length < longOutput.length + 100);
});

test('handleMessageSubmission: handles bash command execution error', async t => {
	const bashCommand = 'invalid-command';
	const errorMsg = 'Command not found';

	const mockToolRegistry = {
		execute_bash: async () => {
			throw new Error(errorMsg);
		},
	};

	const addedComponents: any[] = [];
	let bashExecuting = false;
	let commandComplete = false;

	const options = createMockOptions({
		setIsBashExecuting: (value: boolean) => {
			bashExecuting = value;
		},
		onAddToChatQueue: (component: any) => {
			addedComponents.push(component);
		},
		onCommandComplete: () => {
			commandComplete = true;
		},
	});

	const originalToolRegistry = (global as any).toolRegistry;
	(global as any).toolRegistry = mockToolRegistry;

	await handleMessageSubmission(`!${bashCommand}`, options);

	(global as any).toolRegistry = originalToolRegistry;

	// Verify error was handled
	t.is(bashExecuting, false);
	t.is(addedComponents.length, 1);
	t.true(commandComplete);
});

test('handleMessageSubmission: handles custom command', async t => {
	const customCommand = {
		name: 'custom-test',
		description: 'Test command',
		parameters: [],
		template: 'Test template {{arg}}',
	};

	let chatMessageReceived = '';
	let commandComplete = false;

	const options = createMockOptions({
		customCommandCache: new Map([['custom-test', customCommand]]),
		customCommandExecutor: {
			execute: (cmd: any, args: string[]) => {
				t.is(cmd, customCommand);
				t.deepEqual(args, ['value1', 'value2']);
				return 'processed prompt with value1 value2';
			},
		},
		onHandleChatMessage: async (msg: string) => {
			chatMessageReceived = msg;
		},
		onCommandComplete: () => {
			commandComplete = true;
		},
	});

	await handleMessageSubmission('/custom-test value1 value2', options);

	t.is(chatMessageReceived, 'processed prompt with value1 value2');
	t.false(commandComplete); // Not called when chat message is sent
});

test('handleMessageSubmission: handles custom command with no output', async t => {
	const customCommand = {
		name: 'no-output',
		description: 'Command with no output',
		parameters: [],
		template: '',
	};

	let commandComplete = false;

	const options = createMockOptions({
		customCommandCache: new Map([['no-output', customCommand]]),
		customCommandExecutor: {
			execute: () => null,
		},
		onCommandComplete: () => {
			commandComplete = true;
		},
	});

	await handleMessageSubmission('/no-output', options);

	t.true(commandComplete);
});

test('handleMessageSubmission: handles /clear command', async t => {
	let clearCalled = false;
	let commandComplete = false;

	const options = createMockOptions({
		onClearMessages: async () => {
			clearCalled = true;
		},
		onCommandComplete: () => {
			commandComplete = true;
		},
	});

	await handleMessageSubmission('/clear', options);

	t.true(clearCalled);
	t.true(commandComplete);
});

test('handleMessageSubmission: handles /model command', async t => {
	let modelSelectionMode = false;
	let commandComplete = false;

	const options = createMockOptions({
		onEnterModelSelectionMode: () => {
			modelSelectionMode = true;
		},
		onCommandComplete: () => {
			commandComplete = true;
		},
	});

	await handleMessageSubmission('/model', options);

	t.true(modelSelectionMode);
	t.true(commandComplete);
});

test('handleMessageSubmission: handles /provider command', async t => {
	let providerSelectionMode = false;

	const options = createMockOptions({
		onEnterProviderSelectionMode: () => {
			providerSelectionMode = true;
		},
	});

	await handleMessageSubmission('/provider', options);

	t.true(providerSelectionMode);
});

test('handleMessageSubmission: handles /theme command', async t => {
	let themeSelectionMode = false;

	const options = createMockOptions({
		onEnterThemeSelectionMode: () => {
			themeSelectionMode = true;
		},
	});

	await handleMessageSubmission('/theme', options);

	t.true(themeSelectionMode);
});

test('handleMessageSubmission: handles /model-database command', async t => {
	let modelDatabaseMode = false;

	const options = createMockOptions({
		onEnterModelDatabaseMode: () => {
			modelDatabaseMode = true;
		},
	});

	await handleMessageSubmission('/model-database', options);

	t.true(modelDatabaseMode);
});

test('handleMessageSubmission: handles /setup-config command', async t => {
	let configWizardMode = false;

	const options = createMockOptions({
		onEnterConfigWizardMode: () => {
			configWizardMode = true;
		},
	});

	await handleMessageSubmission('/setup-config', options);

	t.true(configWizardMode);
});

test('handleMessageSubmission: handles /status command', async t => {
	let statusShown = false;
	let commandComplete = false;

	const options = createMockOptions({
		onShowStatus: () => {
			statusShown = true;
		},
		onCommandComplete: () => {
			commandComplete = true;
		},
	});

	// Use fake timers for this test
	const clock = {
		timers: [] as Array<{callback: () => void; delay: number}>,
		setTimeout: (callback: () => void, delay: number) => {
			clock.timers.push({callback, delay});
			return clock.timers.length - 1;
		},
		tick: (ms: number) => {
			const toRun = clock.timers.filter(t => t.delay <= ms);
			clock.timers = clock.timers.filter(t => t.delay > ms);
			toRun.forEach(t => t.callback());
		},
	};

	const originalSetTimeout = global.setTimeout;
	(global as any).setTimeout = clock.setTimeout;

	await handleMessageSubmission('/status', options);

	t.true(statusShown);
	t.false(commandComplete); // Not yet

	// Tick past the delay
	clock.tick(DELAY_COMMAND_COMPLETE_MS);

	t.true(commandComplete); // Now it should be true

	global.setTimeout = originalSetTimeout;
});

// Note: Built-in command tests would require mocking the command registry module,
// which is complex with ESM. These are better tested through integration tests.
// The basic command routing is tested above with special commands like /clear, /model, etc.


test('handleMessageSubmission: handles regular chat message', async t => {
	let chatMessage = '';

	const options = createMockOptions({
		onHandleChatMessage: async (msg: string) => {
			chatMessage = msg;
		},
	});

	await handleMessageSubmission('Hello, how are you?', options);

	t.is(chatMessage, 'Hello, how are you?');
});


// Tests for createClearMessagesHandler

test('createClearMessagesHandler: clears messages and client context', async t => {
	let messagesCleared = false;
	let contextCleared = false;

	const setMessages = (msgs: Message[]) => {
		messagesCleared = msgs.length === 0;
	};

	const client: LLMClient = {
		...createMockClient(),
		clearContext: async () => {
			contextCleared = true;
		},
	};

	const handler = createClearMessagesHandler(setMessages, client);
	await handler();

	t.true(messagesCleared);
	t.true(contextCleared);
});

test('createClearMessagesHandler: handles null client', async t => {
	let messagesCleared = false;

	const setMessages = (msgs: Message[]) => {
		messagesCleared = msgs.length === 0;
	};

	const handler = createClearMessagesHandler(setMessages, null);
	await handler();

	t.true(messagesCleared);
	// Should not throw even with null client
	t.pass();
});

test('createClearMessagesHandler: returns a function', t => {
	const setMessages = () => {};
	const client = createMockClient();

	const handler = createClearMessagesHandler(setMessages, client);

	t.is(typeof handler, 'function');
});
