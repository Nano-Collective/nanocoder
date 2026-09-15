import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'ava';
import React from 'react';
import {
	createClearMessagesHandler,
	handleMessageSubmission,
	parseCustomCommandArgs,
} from './app-util.js';
import {SETTINGS_TAB_IDS} from '@/app/components/settings-constants';
import {commandRegistry} from '@/commands';
import {lazyCommands} from '@/commands/lazy-registry';
import BashProgress from '@/components/bash-progress';
import CommandProgress from '@/components/command-progress';
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
	t.deepEqual(parseCustomCommandArgs('arg1 arg2 arg3'), [
		'arg1',
		'arg2',
		'arg3',
	]);
});

test('custom command args extraction - no arguments', t => {
	t.deepEqual(parseCustomCommandArgs(''), []);
});

test('custom command args extraction - extra whitespace', t => {
	t.deepEqual(parseCustomCommandArgs('   arg1    arg2  '), ['arg1', 'arg2']);
});

test('custom command args extraction - double quoted multi-word argument', t => {
	t.deepEqual(parseCustomCommandArgs('arg1 "multi word arg" arg3'), [
		'arg1',
		'multi word arg',
		'arg3',
	]);
});

test('custom command args extraction - single quoted multi-word argument', t => {
	t.deepEqual(parseCustomCommandArgs("arg1 'multi word arg' arg3"), [
		'arg1',
		'multi word arg',
		'arg3',
	]);
});

test('custom command args extraction - backtick quoted multi-word argument', t => {
	t.deepEqual(parseCustomCommandArgs('arg1 `multi word arg` arg3'), [
		'arg1',
		'multi word arg',
		'arg3',
	]);
});

test('custom command args extraction - escaped quote inside quoted argument', t => {
	t.deepEqual(parseCustomCommandArgs('"say \\"hello\\"" next'), [
		'say "hello"',
		'next',
	]);
});

test('custom command args extraction - empty quoted argument', t => {
	t.deepEqual(parseCustomCommandArgs('arg1 "" arg3'), ['arg1', '', 'arg3']);
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
		MODEL_DATABASE: 'model-database',
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
}): MessageSubmissionOptions {
	return {
		customCommandCache: new Map(),
		customCommandLoader: null,
		customCommandExecutor: null,
		onClearMessages: async () => {},
		onEnterModelSelectionMode: () => {},
		onEnterModelDatabaseMode: () => {},
		onEnterSettingsMode: () => {},
		onEnterExplorerMode: () => {},
		onEnterIdeSelectionMode: () => {},
		onEnterCheckpointLoadMode: () => {},
		onShowStatus: () => {},
		onHandleChatMessage: async () => {},
		onAddToChatQueue: overrides.onAddToChatQueue ?? (() => {}),
		setLiveComponent: () => {},
		setLiveComponentCapturesInput: () => {},
		setIsToolExecuting: () => {},
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

// --- Direct !command handling ---

test.serial('stats command captures input and releases it on close', async t => {
	let liveComponent: React.ReactNode = null;
	const captureStates: boolean[] = [];
	const options = createResumeTestOptions({});
	options.setLiveComponent = component => {
		liveComponent = component;
	};
	options.setLiveComponentCapturesInput = value => {
		captureStates.push(value);
	};

	await handleMessageSubmission('/stats all-time', options);

	t.deepEqual(captureStates, [true]);
	t.true(React.isValidElement(liveComponent));
	const onClose = (liveComponent as React.ReactElement<{onClose: () => void}>).props
		.onClose;
	t.truthy(onClose);
	onClose();
	t.deepEqual(captureStates, [true, false]);
});

test.serial('stats reset command clears the ledger and reports success', async t => {
	const previousDataDir = process.env.NANOCODER_DATA_DIR;
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-stats-reset-'));
	process.env.NANOCODER_DATA_DIR = dataDir;

	try {
		const {flushStatsLedgerSync, recordTokenUsage} = await import('@/stats/record');
		recordTokenUsage({
			provider: 'OpenRouter',
			model: 'gpt-5',
			tokens: 100,
		});
		flushStatsLedgerSync();

		let queued: React.ReactNode = null;
		let completed = 0;
		const options = createResumeTestOptions({
			onAddToChatQueue: component => {
				queued = component;
			},
			onCommandComplete: () => {
				completed++;
			},
		});

		await handleMessageSubmission('/stats reset', options);

		t.false(fs.existsSync(path.join(dataDir, 'stats.json')));
		t.true(React.isValidElement(queued));
		t.is(
			(queued as React.ReactElement<{message: string}>).props.message,
			'Lifetime stats reset.',
		);
		t.is(completed, 1);
	} finally {
		if (previousDataDir === undefined) {
			delete process.env.NANOCODER_DATA_DIR;
		} else {
			process.env.NANOCODER_DATA_DIR = previousDataDir;
		}
		fs.rmSync(dataDir, {recursive: true, force: true});
	}
});

test.serial('bash command does not capture input', async t => {
	const captureStates: boolean[] = [];
	const options = createResumeTestOptions({});
	options.setLiveComponentCapturesInput = value => {
		captureStates.push(value);
	};

	await handleMessageSubmission('!printf DIRECT_BASH_OUTPUT', options);

	t.deepEqual(captureStates, []);
});

test.serial('bash command - queues a completed BashProgress with showOutput', async t => {
	let queued: React.ReactNode = null;
	const options = createResumeTestOptions({
		onAddToChatQueue: component => {
			queued = component;
		},
	});

	await handleMessageSubmission('!printf DIRECT_BASH_OUTPUT', options);

	t.true(React.isValidElement(queued));
	const element = queued as React.ReactElement<{
		showOutput?: boolean;
		completedState?: {fullOutput: string};
	}>;
	t.is(element.type, BashProgress);
	// User-typed !commands must render their captured output in the transcript;
	// model-invoked execute_bash renders stay compact (no showOutput)
	t.true(element.props.showOutput);
	t.is(element.props.completedState?.fullOutput.trim(), 'DIRECT_BASH_OUTPUT');
});

test.serial('chat message - forwards displayValue to onHandleChatMessage so the bubble keeps [@file] placeholders', async t => {
	// Regression: an @-mentioned file used to dump its full contents into the
	// chat bubble whenever the message was transformed downstream (e.g. the
	// VS Code editor pill), because the display version was reconstructed via a
	// brittle string-equality check. The display version is now threaded
	// explicitly, so the bubble renders [@file] while the LLM gets the contents.
	let received: {message?: string; displayValue?: string} = {};
	const options = createResumeTestOptions({});
	options.onHandleChatMessage = async (message, displayValue) => {
		received = {message, displayValue};
	};

	const assembled = '=== File: app.tsx ===\nfull file contents here\n=====================';
	await handleMessageSubmission(assembled, options, '[@app.tsx]');

	t.is(received.message, assembled, 'LLM receives the fully expanded file contents');
	t.is(
		received.displayValue,
		'[@app.tsx]',
		'bubble receives the placeholder, not the expanded contents',
	);
});

test.serial('slash command - leading whitespace still dispatches as a command', async t => {
	// parseInput trims before testing for `/`, so routing has to trim too —
	// dispatching on the raw string sent `  /stats` to the model as chat.
	let chatMessage: string | undefined;
	let liveComponent: React.ReactNode = null;
	const options = createResumeTestOptions({});
	options.onHandleChatMessage = async message => {
		chatMessage = message;
	};
	options.setLiveComponent = component => {
		liveComponent = component;
	};

	await handleMessageSubmission('  /stats all-time', options);

	t.is(chatMessage, undefined, 'a slash command must not reach the model');
	t.true(React.isValidElement(liveComponent));
});

test.serial('chat message - displayValue is optional (callers without a placeholder view)', async t => {
	let received: {message?: string; displayValue?: string} = {};
	const options = createResumeTestOptions({});
	options.onHandleChatMessage = async (message, displayValue) => {
		received = {message, displayValue};
	};

	await handleMessageSubmission('plain message', options);

	t.is(received.message, 'plain message');
	t.is(received.displayValue, undefined);
});

test.serial('retry command - /retry without a prior user turn shows an error', async t => {
	let queued: React.ReactNode = null;
	let submitted = false;
	let completed = false;
	const options = createResumeTestOptions({
		onAddToChatQueue: node => {
			queued = node;
		},
		onCommandComplete: () => {
			completed = true;
		},
	});
	options.onHandleChatMessage = async () => {
		submitted = true;
	};

	await handleMessageSubmission('/retry', options);

	t.false(submitted);
	t.true(completed);
	t.true(
		React.isValidElement(queued) &&
			String((queued.props as {message?: string}).message).includes(
				'No user message to retry',
			),
	);
});

test.serial('retry command - /retry re-submits the last user message', async t => {
	const submitted: Array<{message: string; displayValue?: string}> = [];
	const options = createResumeTestOptions({
		onCommandComplete: () => {},
	});
	options.messages = [
		{role: 'user', content: 'first request'},
		{role: 'assistant', content: 'first response'},
		{role: 'user', content: 'retry this one'},
		{role: 'assistant', content: 'second response'},
	];
	options.onHandleChatMessage = async (message, displayValue) => {
		submitted.push({message, displayValue});
	};

	await handleMessageSubmission('/retry', options);

	t.deepEqual(submitted, [
		{message: 'retry this one', displayValue: 'retry this one'},
	]);
});

test.serial('retry command - /retry --model switches model before re-submit', async t => {
	const events: string[] = [];
	const options = createResumeTestOptions({
		onCommandComplete: () => {},
	});
	options.messages = [{role: 'user', content: 'try another model'}];
	options.onSwitchModel = async (provider, model) => {
		events.push(`switch:${provider}:${model}`);
		return true;
	};
	options.onHandleChatMessage = async message => {
		events.push(`submit:${message}`);
	};

	await handleMessageSubmission('/retry --model "model with spaces"', options);

	t.deepEqual(events, [
		'switch:test:model with spaces',
		'submit:try another model',
	]);
});

test.serial('retry command - /retry --provider switches provider and model before re-submit', async t => {
	const events: string[] = [];
	const options = createResumeTestOptions({
		onCommandComplete: () => {},
	});
	options.messages = [{role: 'user', content: 'cross provider'}];
	options.onSwitchModel = async (provider, model) => {
		events.push(`switch:${provider}:${model}`);
		return true;
	};
	options.onHandleChatMessage = async message => {
		events.push(`submit:${message}`);
	};

	await handleMessageSubmission(
		'/retry --provider openrouter --model qwen/code',
		options,
	);

	t.deepEqual(events, ['switch:openrouter:qwen/code', 'submit:cross provider']);
});

test.serial('retry command - failed model switch does not re-submit', async t => {
	const events: string[] = [];
	const options = createResumeTestOptions({
		onCommandComplete: () => {
			events.push('complete');
		},
	});
	options.messages = [{role: 'user', content: 'do not retry on old model'}];
	options.onSwitchModel = async (provider, model) => {
		events.push(`switch:${provider}:${model}`);
		return false;
	};
	options.onHandleChatMessage = async message => {
		events.push(`submit:${message}`);
	};

	await handleMessageSubmission('/retry --model unavailable-model', options);

	t.deepEqual(events, ['switch:test:unavailable-model', 'complete']);
});

test('retry command - lazy registry exposes /retry', t => {
	const retry = lazyCommands.find(command => command.name === 'retry');

	t.truthy(retry);
	t.is(
		retry?.description,
		'Re-run the last user turn (use --model <id> to switch models first)',
	);
});

test.serial('/plan is rejected and cannot bypass the Shift+Tab mode cycle', async t => {
	const modeChanges: string[] = [];
	let queued: React.ReactNode = null;
	const options = createResumeTestOptions({
		onAddToChatQueue: component => {
			queued = component;
		},
	});
	options.developmentMode = 'normal';
	Object.assign(options, {
		onSetDevelopmentMode: (mode: string) => {
			modeChanges.push(mode);
		},
	});

	await handleMessageSubmission('/plan', options);
	await Promise.resolve();

	t.deepEqual(modeChanges, []);
	t.true(
		React.isValidElement(queued) &&
			String((queued.props as {message?: string}).message).includes(
				'Unknown command: plan',
			),
	);
});

test('/plan is not discoverable because Shift+Tab is the only mode switch', t => {
	const plan = lazyCommands.find(command => command.name === 'plan');

	t.is(plan, undefined);
});

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

// --- /rename command tests ---

function createRenameTestOptions(overrides: {
	onRenameSession?: (name: string) => void;
	onAddToChatQueue?: (component: React.ReactNode) => void;
	onCommandComplete?: () => void;
	commandArgs?: string[];
}): MessageSubmissionOptions {
	return {
		customCommandCache: new Map(),
		customCommandLoader: null,
		customCommandExecutor: null,
		onClearMessages: async () => {},
		onRenameSession: overrides.onRenameSession ?? (() => {}),
		commandArgs: overrides.commandArgs,
		onEnterModelSelectionMode: () => {},
		onEnterModelDatabaseMode: () => {},
		onEnterSettingsMode: () => {},
		onEnterExplorerMode: () => {},
		onEnterIdeSelectionMode: () => {},
		onEnterCheckpointLoadMode: () => {},
		onShowStatus: () => {},
		onHandleChatMessage: async () => {},
		onAddToChatQueue: overrides.onAddToChatQueue ?? (() => {}),
		setLiveComponent: () => {},
		setLiveComponentCapturesInput: () => {},
		setIsToolExecuting: () => {},
		setMessages: () => {},
		messages: [],
		provider: 'test',
		model: 'test',
		theme: 'dark',
		updateInfo: null,
		getMessageTokens: () => 0,
		onCommandComplete: overrides.onCommandComplete,
	} as unknown as MessageSubmissionOptions;
}

function findMessageInQueue(
	queue: React.ReactNode[],
	predicate: (msg: string) => boolean,
): boolean {
	return queue.some(node => {
		if (!React.isValidElement(node)) return false;
		const props = node.props as {message?: unknown};
		return typeof props.message === 'string' && predicate(props.message);
	});
}

test('rename command - valid name calls onRenameSession with trimmed value', async t => {
	let capturedName: string | undefined;
	const options = createRenameTestOptions({
		onRenameSession: name => {
			capturedName = name;
		},
		commandArgs: ['my-session'],
	});
	await handleMessageSubmission('/rename my-session', options);
	t.is(capturedName, 'my-session');
});

test('rename command - multi-word name is joined with spaces', async t => {
	let capturedName: string | undefined;
	const options = createRenameTestOptions({
		onRenameSession: name => {
			capturedName = name;
		},
		commandArgs: ['my', 'cool', 'session'],
	});
	await handleMessageSubmission('/rename my cool session', options);
	t.is(capturedName, 'my cool session');
});

test('rename command - empty args show usage error', async t => {
	const queue: React.ReactNode[] = [];
	let renamedCalled = false;
	const options = createRenameTestOptions({
		onRenameSession: () => {
			renamedCalled = true;
		},
		onAddToChatQueue: node => {
			queue.push(node);
		},
		commandArgs: [],
	});
	await handleMessageSubmission('/rename', options);
	t.false(renamedCalled, 'onRenameSession should not be called for empty args');
	t.true(
		findMessageInQueue(queue, m => m.includes('Usage')),
		'an error message containing "Usage" should be queued',
	);
});

test('rename command - whitespace-only name shows usage error', async t => {
	const queue: React.ReactNode[] = [];
	let renamedCalled = false;
	const options = createRenameTestOptions({
		onRenameSession: () => {
			renamedCalled = true;
		},
		onAddToChatQueue: node => {
			queue.push(node);
		},
		commandArgs: ['   '],
	});
	await handleMessageSubmission('/rename    ', options);
	t.false(renamedCalled);
	t.true(findMessageInQueue(queue, m => m.includes('Usage')));
});

test('rename command - name over MAX_SESSION_NAME_LENGTH shows error', async t => {
	const queue: React.ReactNode[] = [];
	let renamedCalled = false;
	const longName = 'a'.repeat(150);
	const options = createRenameTestOptions({
		onRenameSession: () => {
			renamedCalled = true;
		},
		onAddToChatQueue: node => {
			queue.push(node);
		},
		commandArgs: [longName],
	});
	await handleMessageSubmission(`/rename ${longName}`, options);
	t.false(renamedCalled, 'onRenameSession should not be called when over the limit');
	t.true(
		findMessageInQueue(queue, m => m.includes('100 characters')),
		'an error message mentioning the 100-character limit should be queued',
	);
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

// --- /settings tabs and retired /setup-* commands ---

function createSettingsTestOptions(overrides: {
	onEnterSettingsMode?: (tab?: string) => void;
	onAddToChatQueue?: (component: React.ReactNode) => void;
	commandArgs?: string[];
}): MessageSubmissionOptions {
	return {
		customCommandCache: new Map(),
		customCommandLoader: null,
		customCommandExecutor: null,
		onClearMessages: async () => {},
		onRenameSession: () => {},
		commandArgs: overrides.commandArgs,
		onEnterModelSelectionMode: () => {},
		onEnterModelDatabaseMode: () => {},
		onEnterSettingsMode: overrides.onEnterSettingsMode ?? (() => {}),
		onEnterExplorerMode: () => {},
		onEnterIdeSelectionMode: () => {},
		onEnterTune: () => {},
		onEnterCheckpointLoadMode: () => {},
		onShowStatus: () => {},
		onHandleChatMessage: async () => {},
		onAddToChatQueue: overrides.onAddToChatQueue ?? (() => {}),
		setLiveComponent: () => {},
		setLiveComponentCapturesInput: () => {},
		setIsToolExecuting: () => {},
		setMessages: () => {},
		messages: [],
		provider: 'test',
		model: 'test',
		theme: 'dark',
		updateInfo: null,
		getMessageTokens: () => 0,
	} as unknown as MessageSubmissionOptions;
}

test('settings command - no argument leaves the tab unset', async t => {
	let captured: string | undefined | symbol = Symbol('uncalled');
	const options = createSettingsTestOptions({
		onEnterSettingsMode: tab => {
			captured = tab;
		},
	});
	await handleMessageSubmission('/settings', options);
	t.is(captured, undefined);
});

test('settings command - known tab argument opens that tab', async t => {
	let captured: string | undefined;
	const options = createSettingsTestOptions({
		onEnterSettingsMode: tab => {
			captured = tab;
		},
		commandArgs: ['mcp'],
	});
	await handleMessageSubmission('/settings mcp', options);
	t.is(captured, 'mcp');
});

test('settings command - tab argument is case-insensitive', async t => {
	let captured: string | undefined;
	const options = createSettingsTestOptions({
		onEnterSettingsMode: tab => {
			captured = tab;
		},
		commandArgs: ['Providers'],
	});
	await handleMessageSubmission('/settings Providers', options);
	t.is(captured, 'providers');
});

test('settings command - unknown tab reports an error instead of opening', async t => {
	let called = false;
	const queue: React.ReactNode[] = [];
	const options = createSettingsTestOptions({
		onEnterSettingsMode: () => {
			called = true;
		},
		onAddToChatQueue: c => queue.push(c),
		commandArgs: ['bogus'],
	});
	await handleMessageSubmission('/settings bogus', options);
	t.false(called, 'an unknown tab should not silently open the default tab');
	t.true(
		findMessageInQueue(queue, m => m.includes('Unknown settings tab: "bogus"')),
		'the error names the offending argument',
	);
});

test('settings command - unknown tab error lists the valid tabs', async t => {
	const queue: React.ReactNode[] = [];
	const options = createSettingsTestOptions({
		onAddToChatQueue: c => queue.push(c),
		commandArgs: ['providrs'],
	});
	await handleMessageSubmission('/settings providrs', options);
	t.true(
		findMessageInQueue(queue, m =>
			SETTINGS_TAB_IDS.every(tab => m.includes(tab)),
		),
		'the error lists every valid tab so the typo is recoverable',
	);
});

test('retired setup-providers - forwards to the settings providers tab', async t => {
	let captured: string | undefined;
	const queue: React.ReactNode[] = [];
	const options = createSettingsTestOptions({
		onEnterSettingsMode: tab => {
			captured = tab;
		},
		onAddToChatQueue: c => queue.push(c),
	});
	await handleMessageSubmission('/setup-providers', options);
	t.is(captured, 'providers');
	t.true(findMessageInQueue(queue, m => m.includes('/settings providers')));
});

test('retired setup-mcp - forwards to the settings mcp tab', async t => {
	let captured: string | undefined;
	const queue: React.ReactNode[] = [];
	const options = createSettingsTestOptions({
		onEnterSettingsMode: tab => {
			captured = tab;
		},
		onAddToChatQueue: c => queue.push(c),
	});
	await handleMessageSubmission('/setup-mcp', options);
	t.is(captured, 'mcp');
	t.true(findMessageInQueue(queue, m => m.includes('/settings mcp')));
});

test('retired setup commands - no longer registered in the slash menu', t => {
	const names = lazyCommands.map(c => c.name);
	t.false(names.includes('setup-providers'));
	t.false(names.includes('setup-mcp'));
	t.true(names.includes('settings'));
	t.true(names.includes('setup-config'), 'unrelated /setup-config stays');
});

// --- Command progress spinner (Command.progressLabel) ---

// The registry is populated at app init, not at module load, so the spec has
// to register the lazy entries itself before driving a built-in command.
commandRegistry.registerLazy(lazyCommands);

function createProgressTestOptions(overrides: {
	setLiveComponent?: (component: React.ReactNode) => void;
	onAddToChatQueue?: (component: React.ReactNode) => void;
}): MessageSubmissionOptions {
	return {
		...createResumeTestOptions({
			onAddToChatQueue: overrides.onAddToChatQueue,
		}),
		setLiveComponent: overrides.setLiveComponent ?? (() => {}),
	};
}

test.serial(
	'progress spinner - /commit mounts CommandProgress then clears it',
	async t => {
		const live: React.ReactNode[] = [];
		const options = createProgressTestOptions({
			setLiveComponent: component => live.push(component),
		});

		await handleMessageSubmission('/commit', options);

		t.is(live.length, 2, 'spinner is mounted once and cleared once');

		const spinner = live[0] as React.ReactElement<{label?: string}>;
		t.true(React.isValidElement(spinner));
		t.is(spinner.type, CommandProgress);
		t.is(spinner.props.label, 'Generating commit message');

		t.is(live[1], null, 'live slot is released after the handler settles');
	},
);

test.serial(
	'progress spinner - cleared even when the command handler throws',
	async t => {
		const live: React.ReactNode[] = [];
		const options = createProgressTestOptions({
			setLiveComponent: component => live.push(component),
		});

		// getMessageTokens runs after the spinner is mounted, so throwing there
		// aborts the command with a spinner already on screen.
		const boom = {
			...options,
			messages: [{role: 'user' as const, content: 'x'}],
			getMessageTokens: () => {
				throw new Error('boom');
			},
		};

		await t.throwsAsync(() => handleMessageSubmission('/commit', boom));

		t.is(live.length, 2);
		t.is(live[1], null, 'a throwing handler must not strand the spinner');
	},
);

test.serial(
	'progress spinner - commands without progressLabel leave the live slot alone',
	async t => {
		const live: React.ReactNode[] = [];
		const options = createProgressTestOptions({
			setLiveComponent: component => live.push(component),
		});

		await handleMessageSubmission('/help', options);

		t.deepEqual(live, [], '/help is instant and declares no progressLabel');
	},
);

test('progress spinner - only slow commands opt in', t => {
	const commit = lazyCommands.find(c => c.name === 'commit');
	t.is(commit?.progressLabel, 'Generating commit message');

	const help = lazyCommands.find(c => c.name === 'help');
	t.is(help?.progressLabel, undefined);
});
