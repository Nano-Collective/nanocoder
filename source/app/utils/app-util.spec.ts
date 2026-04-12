import test from 'ava';
import React from 'react';
import {createClearMessagesHandler, handleMessageSubmission, parseContextLimit} from './app-util.js';
import type {MessageSubmissionOptions} from '@/types/index';
import type {Session} from '@/session/session-manager';
import {sessionManager} from '@/session/session-manager';

// Test command parsing edge cases
// These tests document the expected behavior of parsing patterns

test('bash command detection - message starting with !', t => {
	const message = '!ls -la';
	const isBashCommand = message.startsWith('!');
	t.true(isBashCommand);
});

test('bash command detection - message not starting with !', t => {
	const message = 'ls -la';
	const isBashCommand = message.startsWith('!');
	t.false(isBashCommand);
});

test('slash command detection - message starting with /', t => {
	const message = '/help';
	const isSlashCommand = message.startsWith('/');
	t.true(isSlashCommand);
});

test('slash command parsing - extracts command name correctly', t => {
	const message = '/model gpt-4';
	const commandName = message.slice(1).split(/\s+/)[0];
	t.is(commandName, 'model');
});

test('slash command parsing - handles command without args', t => {
	const message = '/clear';
	const commandName = message.slice(1).split(/\s+/)[0];
	t.is(commandName, 'clear');
});

test('slash command parsing - handles command with multiple args', t => {
	const message = '/checkpoint load my-checkpoint';
	const parts = message.slice(1).split(/\s+/);
	t.is(parts[0], 'checkpoint');
	t.is(parts[1], 'load');
	t.is(parts[2], 'my-checkpoint');
});

// Test custom command argument extraction
test('custom command args extraction - with arguments', t => {
	const message = '/mycommand arg1 arg2 arg3';
	const commandName = 'mycommand';
	const args = message
		.slice(commandName.length + 2)
		.trim()
		.split(/\s+/)
		.filter(arg => arg);

	t.deepEqual(args, ['arg1', 'arg2', 'arg3']);
});

test('custom command args extraction - no arguments', t => {
	const message = '/mycommand';
	const commandName = 'mycommand';
	const args = message
		.slice(commandName.length + 2)
		.trim()
		.split(/\s+/)
		.filter(arg => arg);

	t.deepEqual(args, []);
});

test('custom command args extraction - extra whitespace', t => {
	const message = '/mycommand   arg1    arg2  ';
	const commandName = 'mycommand';
	const args = message
		.slice(commandName.length + 2)
		.trim()
		.split(/\s+/)
		.filter(arg => arg);

	t.deepEqual(args, ['arg1', 'arg2']);
});

// Test checkpoint load detection
test('checkpoint load detection - load subcommand', t => {
	const commandParts = ['checkpoint', 'load'];
	const isCheckpointLoad =
		commandParts[0] === 'checkpoint' &&
		(commandParts[1] === 'load' || commandParts[1] === 'restore') &&
		commandParts.length === 2;
	t.true(isCheckpointLoad);
});

test('checkpoint load detection - restore subcommand', t => {
	const commandParts = ['checkpoint', 'restore'];
	const isCheckpointLoad =
		commandParts[0] === 'checkpoint' &&
		(commandParts[1] === 'load' || commandParts[1] === 'restore') &&
		commandParts.length === 2;
	t.true(isCheckpointLoad);
});

test('checkpoint load detection - with specific checkpoint name', t => {
	const commandParts = ['checkpoint', 'load', 'my-checkpoint'];
	const isCheckpointLoad =
		commandParts[0] === 'checkpoint' &&
		(commandParts[1] === 'load' || commandParts[1] === 'restore') &&
		commandParts.length === 2;
	// Should be false - specific checkpoint specified
	t.false(isCheckpointLoad);
});

test('checkpoint load detection - other checkpoint subcommand', t => {
	const commandParts = ['checkpoint', 'save'];
	const isCheckpointLoad =
		commandParts[0] === 'checkpoint' &&
		(commandParts[1] === 'load' || commandParts[1] === 'restore') &&
		commandParts.length === 2;
	t.false(isCheckpointLoad);
});

// Test setup-mcp command parsing
test('setup-mcp command parsing - extracts command name correctly', t => {
	const message = '/setup-mcp';
	const commandName = message.slice(1).split(/\s+/)[0];
	t.is(commandName, 'setup-mcp');
});

test('setup-mcp command parsing - handles command with extra whitespace', t => {
	const message = '/setup-mcp   ';
	const commandName = message.slice(1).split(/\s+/)[0];
	t.is(commandName, 'setup-mcp');
});

// Test /commands create detection
test('commands create detection - matches commands create', t => {
	const message = '/commands create my-tool';
	const parts = message.slice(1).trim().split(/\s+/);
	const isCommandCreate =
		(parts[0] === 'commands' || parts[0] === 'custom-commands') &&
		parts[1] === 'create';
	t.true(isCommandCreate);
	t.is(parts[2], 'my-tool');
});

test('commands create detection - matches custom-commands create', t => {
	const message = '/custom-commands create review-code';
	const parts = message.slice(1).trim().split(/\s+/);
	const isCommandCreate =
		(parts[0] === 'commands' || parts[0] === 'custom-commands') &&
		parts[1] === 'create';
	t.true(isCommandCreate);
	t.is(parts[2], 'review-code');
});

test('commands create detection - does not match other subcommands', t => {
	const message = '/commands show my-tool';
	const parts = message.slice(1).trim().split(/\s+/);
	const isCommandCreate =
		(parts[0] === 'commands' || parts[0] === 'custom-commands') &&
		parts[1] === 'create';
	t.false(isCommandCreate);
});

test('commands create detection - does not match unrelated commands', t => {
	const message = '/schedule create my-task';
	const parts = message.slice(1).trim().split(/\s+/);
	const isCommandCreate =
		(parts[0] === 'commands' || parts[0] === 'custom-commands') &&
		parts[1] === 'create';
	t.false(isCommandCreate);
});

test('commands create detection - missing name yields undefined part', t => {
	const message = '/commands create';
	const parts = message.slice(1).trim().split(/\s+/);
	const isCommandCreate =
		(parts[0] === 'commands' || parts[0] === 'custom-commands') &&
		parts[1] === 'create';
	t.true(isCommandCreate);
	t.is(parts[2], undefined);
});

test('commands create - appends .md extension when missing', t => {
	const fileName = 'my-tool';
	const safeName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
	t.is(safeName, 'my-tool.md');
});

test('commands create - preserves .md extension when present', t => {
	const fileName = 'my-tool.md';
	const safeName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
	t.is(safeName, 'my-tool.md');
});

// Test parseContextLimit
test('parseContextLimit - plain number', t => {
	t.is(parseContextLimit('8192'), 8192);
});

test('parseContextLimit - k suffix lowercase', t => {
	t.is(parseContextLimit('128k'), 128000);
});

test('parseContextLimit - K suffix uppercase', t => {
	t.is(parseContextLimit('128K'), 128000);
});

test('parseContextLimit - fractional k value', t => {
	t.is(parseContextLimit('4.5k'), 4500);
});

test('parseContextLimit - zero returns null', t => {
	t.is(parseContextLimit('0'), null);
});

test('parseContextLimit - negative returns null', t => {
	t.is(parseContextLimit('-5'), null);
});

test('parseContextLimit - non-numeric returns null', t => {
	t.is(parseContextLimit('abc'), null);
});

test('parseContextLimit - just k returns null', t => {
	t.is(parseContextLimit('k'), null);
});

test('parseContextLimit - whitespace is trimmed', t => {
	t.is(parseContextLimit('  8192  '), 8192);
});

test('parseContextLimit - large value with k suffix', t => {
	t.is(parseContextLimit('256k'), 256000);
});

test('parseContextLimit - decimal without k suffix', t => {
	t.is(parseContextLimit('1024.5'), 1025);
});

// Test /ide command parsing
test('ide command parsing - extracts command name correctly', t => {
	const message = '/ide';
	const commandName = message.slice(1).split(/\s+/)[0];
	t.is(commandName, 'ide');
});

test('ide command parsing - recognized as special command', t => {
	const SPECIAL_COMMANDS: Record<string, string> = {
		CLEAR: 'clear',
		MODEL: 'model',
		PROVIDER: 'provider',
		MODEL_DATABASE: 'model-database',
		SETUP_PROVIDERS: 'setup-providers',
		SETUP_MCP: 'setup-mcp',
		SETTINGS: 'settings',
		STATUS: 'status',
		CHECKPOINT: 'checkpoint',
		EXPLORER: 'explorer',
		IDE: 'ide',
		SCHEDULE: 'schedule',
		COMMANDS: 'commands',
	};
	const commandName = 'ide';
	t.is(
		Object.values(SPECIAL_COMMANDS).includes(commandName),
		true,
	);
});

// --- Resume command tests (/resume, /sessions, /history) ---

function createResumeTestOptions(overrides: {
	onEnterSessionSelectorMode?: (showAll?: boolean) => void;
	onResumeSession?: (session: Session) => void;
	onAddToChatQueue?: (component: React.ReactNode) => void;
	onCommandComplete?: () => void;
	getNextComponentKey?: () => number;
}): MessageSubmissionOptions {
	let key = 0;
	return {
		customCommandCache: new Map(),
		customCommandLoader: null,
		customCommandExecutor: null,
		onClearMessages: async () => {},
		onEnterModelSelectionMode: () => {},
		onEnterProviderSelectionMode: () => {},
		onEnterModelDatabaseMode: () => {},
		onEnterConfigWizardMode: () => {},
		onEnterSettingsMode: () => {},
		onEnterMcpWizardMode: () => {},
		onEnterExplorerMode: () => {},
		onEnterIdeSelectionMode: () => {},
		onEnterCheckpointLoadMode: () => {},
		onShowStatus: () => {},
		onHandleChatMessage: async () => {},
		onAddToChatQueue: overrides.onAddToChatQueue ?? (() => {}),
		setLiveComponent: () => {},
		setIsToolExecuting: () => {},
		getNextComponentKey: overrides.getNextComponentKey ?? (() => ++key),
		setMessages: () => {},
		messages: [],
		provider: 'test',
		model: 'test',
		theme: 'dark',
		updateInfo: null,
		getMessageTokens: () => 0,
		onEnterSessionSelectorMode: overrides.onEnterSessionSelectorMode,
		onResumeSession: overrides.onResumeSession,
		onCommandComplete: overrides.onCommandComplete,
	};
}

test.serial('resume command - /resume with no args enters session selector mode', async t => {
	let selectorCalled = false;
	const origInit = sessionManager.initialize.bind(sessionManager);
	sessionManager.initialize = async () => {};
	try {
		const options = createResumeTestOptions({
			onEnterSessionSelectorMode: () => {
				selectorCalled = true;
			},
			onResumeSession: () => {},
		});
		await handleMessageSubmission('/resume', options);
		t.true(selectorCalled, 'onEnterSessionSelectorMode should be called');
	} finally {
		sessionManager.initialize = origInit;
	}
});

test.serial('resume command - /sessions alias enters session selector mode', async t => {
	let selectorCalled = false;
	const origInit = sessionManager.initialize.bind(sessionManager);
	sessionManager.initialize = async () => {};
	try {
		const options = createResumeTestOptions({
			onEnterSessionSelectorMode: () => {
				selectorCalled = true;
			},
			onResumeSession: () => {},
		});
		await handleMessageSubmission('/sessions', options);
		t.true(selectorCalled, 'onEnterSessionSelectorMode should be called for /sessions');
	} finally {
		sessionManager.initialize = origInit;
	}
});

test.serial('resume command - /history alias enters session selector mode', async t => {
	let selectorCalled = false;
	const origInit = sessionManager.initialize.bind(sessionManager);
	sessionManager.initialize = async () => {};
	try {
		const options = createResumeTestOptions({
			onEnterSessionSelectorMode: () => {
				selectorCalled = true;
			},
			onResumeSession: () => {},
		});
		await handleMessageSubmission('/history', options);
		t.true(selectorCalled, 'onEnterSessionSelectorMode should be called for /history');
	} finally {
		sessionManager.initialize = origInit;
	}
});

test.serial('resume command - /resume last resumes most recent session', async t => {
	const mockSession: Session = {
		id: 'session-1',
		title: 'Recent',
		createdAt: new Date().toISOString(),
		lastAccessedAt: new Date().toISOString(),
		messageCount: 5,
		provider: 'test',
		model: 'test',
		workingDirectory: '/tmp',
		messages: [],
	};
	const origInit = sessionManager.initialize.bind(sessionManager);
	const origList = sessionManager.listSessions.bind(sessionManager);
	const origLoad = sessionManager.loadSession.bind(sessionManager);
	sessionManager.initialize = async () => {};
	sessionManager.listSessions = async () => [
		{
			id: mockSession.id,
			title: mockSession.title,
			createdAt: mockSession.createdAt,
			lastAccessedAt: mockSession.lastAccessedAt,
			messageCount: mockSession.messageCount,
			provider: mockSession.provider,
			model: mockSession.model,
			workingDirectory: mockSession.workingDirectory,
		},
	];
	sessionManager.loadSession = async (id: string) =>
		id === mockSession.id ? mockSession : null;
	try {
		let resumedSession: Session | null = null;
		const options = createResumeTestOptions({
			onResumeSession: (session) => {
				resumedSession = session;
			},
			onEnterSessionSelectorMode: () => {},
		});
		await handleMessageSubmission('/resume last', options);
		t.truthy(resumedSession, 'onResumeSession should be called');
		t.is(resumedSession!.id, mockSession.id);
	} finally {
		sessionManager.initialize = origInit;
		sessionManager.listSessions = origList;
		sessionManager.loadSession = origLoad;
	}
});

test.serial('resume command - /resume 1 resumes session at index 1', async t => {
	const mockSession: Session = {
		id: 'session-first',
		title: 'First',
		createdAt: new Date().toISOString(),
		lastAccessedAt: new Date().toISOString(),
		messageCount: 2,
		provider: 'test',
		model: 'test',
		workingDirectory: '/tmp',
		messages: [],
	};
	const origInit = sessionManager.initialize.bind(sessionManager);
	const origList = sessionManager.listSessions.bind(sessionManager);
	const origLoad = sessionManager.loadSession.bind(sessionManager);
	sessionManager.initialize = async () => {};
	sessionManager.listSessions = async () => [
		{
			id: 'session-first',
			title: 'First',
			createdAt: mockSession.createdAt,
			lastAccessedAt: mockSession.lastAccessedAt,
			messageCount: 2,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
		},
	];
	sessionManager.loadSession = async (id: string) =>
		id === mockSession.id ? mockSession : null;
	try {
		let resumedSession: Session | null = null;
		const options = createResumeTestOptions({
			onResumeSession: (session) => {
				resumedSession = session;
			},
			onEnterSessionSelectorMode: () => {},
		});
		await handleMessageSubmission('/resume 1', options);
		t.truthy(resumedSession);
		t.is(resumedSession!.id, 'session-first');
	} finally {
		sessionManager.initialize = origInit;
		sessionManager.listSessions = origList;
		sessionManager.loadSession = origLoad;
	}
});

test.serial('resume command - invalid session id shows error message', async t => {
	const origInit = sessionManager.initialize.bind(sessionManager);
	const origList = sessionManager.listSessions.bind(sessionManager);
	const origLoad = sessionManager.loadSession.bind(sessionManager);
	sessionManager.initialize = async () => {};
	sessionManager.listSessions = async () => [];
	sessionManager.loadSession = async () => null;
	try {
		let queuedComponent: React.ReactNode = null;
		const options = createResumeTestOptions({
			onAddToChatQueue: (component) => {
				queuedComponent = component;
			},
			onEnterSessionSelectorMode: () => {},
			onResumeSession: () => {},
		});
		await handleMessageSubmission('/resume no-such-id', options);
		t.truthy(queuedComponent, 'onAddToChatQueue should be called with error');
		t.true(React.isValidElement(queuedComponent), 'queued component should be a React element');
	} finally {
		sessionManager.initialize = origInit;
		sessionManager.listSessions = origList;
		sessionManager.loadSession = origLoad;
	}
});

test.serial('resume command - /resume --all opens selector in show-all mode', async t => {
	let showAllValue: boolean | undefined;
	const origInit = sessionManager.initialize.bind(sessionManager);
	sessionManager.initialize = async () => {};
	try {
		const options = createResumeTestOptions({
			onEnterSessionSelectorMode: (showAll) => {
				showAllValue = showAll;
			},
			onResumeSession: () => {},
		});
		await handleMessageSubmission('/resume --all', options);
		t.true(showAllValue, 'onEnterSessionSelectorMode should be called with true');
	} finally {
		sessionManager.initialize = origInit;
	}
});

test.serial('resume command - /resume without --all opens selector in project mode', async t => {
	let showAllValue: boolean | undefined = true;
	const origInit = sessionManager.initialize.bind(sessionManager);
	sessionManager.initialize = async () => {};
	try {
		const options = createResumeTestOptions({
			onEnterSessionSelectorMode: (showAll) => {
				showAllValue = showAll;
			},
			onResumeSession: () => {},
		});
		await handleMessageSubmission('/resume', options);
		t.is(showAllValue, undefined, 'onEnterSessionSelectorMode should be called without showAll');
	} finally {
		sessionManager.initialize = origInit;
	}
});

// --- createClearMessagesHandler tests ---

test('createClearMessagesHandler - clears messages to empty array', async t => {
	let capturedMessages: unknown[] | null = null;
	const setMessages = (messages: unknown[]) => {
		capturedMessages = messages;
	};
	const handler = createClearMessagesHandler(setMessages, null);
	await handler();
	t.deepEqual(capturedMessages, [], 'setMessages should be called with empty array');
});

test('createClearMessagesHandler - calls client.clearContext when client exists', async t => {
	let contextCleared = false;
	const mockClient = {
		clearContext: async () => {
			contextCleared = true;
		},
	};
	const handler = createClearMessagesHandler(() => {}, mockClient as any);
	await handler();
	t.true(contextCleared, 'client.clearContext should be called');
});

test('createClearMessagesHandler - does not throw when client is null', async t => {
	const handler = createClearMessagesHandler(() => {}, null);
	await t.notThrowsAsync(() => handler());
});
