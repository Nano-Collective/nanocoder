import test from 'ava';
import React from 'react';
import {commandRegistry} from '@/commands';
import {lazyCommands} from '@/commands/lazy-registry';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import type {
	CommandContext,
	Message,
	MessageSubmissionOptions,
	StatefulCommand,
} from '@/types/index';
import {dispatchSlashCommand} from './command-dispatcher.js';

commandRegistry.registerLazy(lazyCommands);

let lastContext: CommandContext | undefined;
const probeCommand: StatefulCommand = {
	name: 'dispatcher-probe',
	description: 'Records the context it was given',
	run: async context => {
		lastContext = context;
		return 'done';
	},
};
commandRegistry.registerLazy({
	name: probeCommand.name,
	description: probeCommand.description,
	load: async () => probeCommand,
});

commandRegistry.registerLazy({
	name: 'dispatcher-slow-failure',
	description: 'Shows a spinner, then throws',
	progressLabel: 'Working',
	load: async () => ({
		name: 'dispatcher-slow-failure',
		description: 'Shows a spinner, then throws',
		progressLabel: 'Working',
		run: async () => {
			throw new Error('boom');
		},
	}),
});

function createOptions(
	overrides: Partial<MessageSubmissionOptions> = {},
): MessageSubmissionOptions {
	return {
		customCommandCache: new Map(),
		customCommandLoader: null,
		customCommandExecutor: null,
		onClearMessages: async () => {},
		onRenameSession: () => {},
		onEnterModelSelectionMode: () => {},
		onEnterModelDatabaseMode: () => {},
		onEnterSettingsMode: () => {},
		onEnterExplorerMode: () => {},
		onEnterIdeSelectionMode: () => {},
		onEnterTune: () => {},
		onEnterCheckpointLoadMode: () => {},
		onShowStatus: () => {},
		onHandleChatMessage: async () => {},
		onAddToChatQueue: () => {},
		setLiveComponent: () => {},
		setLiveComponentCapturesInput: () => {},
		setIsToolExecuting: () => {},
		setMessages: () => {},
		messages: [],
		provider: 'test',
		providerConfig: null,
		client: null,
		model: 'test',
		theme: 'dark',
		updateInfo: null,
		getMessageTokens: () => 0,
		...overrides,
	};
}

function queuedText(node: React.ReactNode): string {
	if (!React.isValidElement(node)) return '';
	const {message} = node.props as {message?: unknown};
	return typeof message === 'string' ? message : '';
}

function wait(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

test.serial('a stateful command gets its args and the app state in a context', async t => {
	const messages: Message[] = [{role: 'user', content: 'hi'}];
	let completed = 0;
	await dispatchSlashCommand(
		'/dispatcher-probe one two',
		createOptions({messages, onCommandComplete: () => completed++}),
	);

	t.deepEqual(lastContext?.args, ['one', 'two']);
	t.is(lastContext?.messages, messages);
	t.is(completed, 1, "'done' hands the prompt back at once");
});

test.serial('a stateful command reads the submission commandArgs when set', async t => {
	// useAppHandlers strips VS Code context from these; the split message
	// would still carry it.
	await dispatchSlashCommand(
		'/dispatcher-probe kept [@file]<!--vscode-context-->',
		createOptions({commandArgs: ['kept']}),
	);
	t.deepEqual(lastContext?.args, ['kept']);
});

test.serial("'done-after-render' completes after the render delay", async t => {
	let completed = false;
	let renamed: string | undefined;
	await dispatchSlashCommand(
		'/rename My session',
		createOptions({
			onRenameSession: name => {
				renamed = name;
			},
			onCommandComplete: () => {
				completed = true;
			},
		}),
	);

	t.is(renamed, 'My session');
	t.false(completed);
	await wait(DELAY_COMMAND_COMPLETE_MS + 25);
	t.true(completed);
});

test.serial('/clear runs through the context: messages, then the clear counter', async t => {
	const calls: string[] = [];
	await dispatchSlashCommand(
		'/clear',
		createOptions({
			onClearMessages: async () => {
				calls.push('clear-messages');
			},
			onClearCounterIncrement: () => calls.push('clear-counter'),
		}),
	);
	t.deepEqual(calls, ['clear-messages', 'clear-counter']);
});

test.serial('/status shows the status through the context', async t => {
	let shown = 0;
	await dispatchSlashCommand(
		'/status',
		createOptions({onShowStatus: () => shown++}),
	);
	t.is(shown, 1);
});

test.serial('a project command named like a stateful built-in still wins', async t => {
	let cleared = false;
	let completed = false;
	const customCommandCache = new Map([
		['clear', {name: 'clear', fullName: 'clear'}],
	]) as unknown as MessageSubmissionOptions['customCommandCache'];
	await dispatchSlashCommand(
		'/clear',
		createOptions({
			customCommandCache,
			onClearMessages: async () => {
				cleared = true;
			},
			onCommandComplete: () => {
				completed = true;
			},
		}),
	);
	t.false(cleared, 'the built-in /clear should not run');
	t.true(completed);
});

test.serial('a stateful command that throws still releases its spinner', async t => {
	const live: React.ReactNode[] = [];
	await t.throwsAsync(
		dispatchSlashCommand(
			'/dispatcher-slow-failure',
			createOptions({setLiveComponent: node => live.push(node)}),
		),
		{message: 'boom'},
	);
	t.is(live.length, 2);
	t.true(React.isValidElement(live[0]));
	t.is(live[1], null);
});

for (const [message, mode] of [
	['/model', 'model-selection'],
	['/model browse', 'model-database'],
	['/model-database', 'model-database'],
	['/explorer', 'explorer'],
	['/ide', 'ide'],
	['/tune', 'tune'],
	['/settings', 'settings:'],
	['/settings MCP', 'settings:mcp'],
] as const) {
	test.serial(`${message} opens ${mode} and completes at once`, async t => {
		const calls: string[] = [];
		await dispatchSlashCommand(
			message,
			createOptions({
				commandArgs: message.slice(1).split(/\s+/).slice(1),
				onEnterModelSelectionMode: () => calls.push('model-selection'),
				onEnterModelDatabaseMode: () => calls.push('model-database'),
				onEnterExplorerMode: () => calls.push('explorer'),
				onEnterIdeSelectionMode: () => calls.push('ide'),
				onEnterTune: () => calls.push('tune'),
				onEnterSettingsMode: tab => calls.push(`settings:${tab ?? ''}`),
				onCommandComplete: () => calls.push('complete'),
			}),
		);
		t.deepEqual(calls, [mode, 'complete']);
	});
}

test.serial('/settings with an unknown tab errors and completes after render', async t => {
	const queued: React.ReactNode[] = [];
	let opened = false;
	let completed = false;
	await dispatchSlashCommand(
		'/settings nope',
		createOptions({
			commandArgs: ['nope'],
			onAddToChatQueue: node => queued.push(node),
			onEnterSettingsMode: () => {
				opened = true;
			},
			onCommandComplete: () => {
				completed = true;
			},
		}),
	);
	t.false(opened);
	t.true(queuedText(queued[0]).includes('Unknown settings tab: "nope"'));
	t.false(completed);
	await wait(DELAY_COMMAND_COMPLETE_MS + 25);
	t.true(completed);
});

test.serial('a retired name says where it moved, then opens the tab and ignores its own args', async t => {
	const calls: string[] = [];
	const queued: React.ReactNode[] = [];
	await dispatchSlashCommand(
		'/setup-providers extra',
		createOptions({
			commandArgs: ['extra'],
			onAddToChatQueue: node => queued.push(node),
			onEnterSettingsMode: tab => calls.push(`settings:${tab ?? ''}`),
			onCommandComplete: () => calls.push('complete'),
		}),
	);
	t.deepEqual(calls, ['settings:providers', 'complete']);
	t.is(
		queuedText(queued[0]),
		'/setup-providers has moved to /settings — opening the providers tab. Use /settings providers next time.',
	);
});

test.serial('a project command named like a retired command still wins', async t => {
	let opened = false;
	const customCommandCache = new Map([
		['setup-mcp', {name: 'setup-mcp', fullName: 'setup-mcp'}],
	]) as unknown as MessageSubmissionOptions['customCommandCache'];
	await dispatchSlashCommand(
		'/setup-mcp',
		createOptions({
			customCommandCache,
			onEnterSettingsMode: () => {
				opened = true;
			},
		}),
	);
	t.false(opened);
});

test.serial('read-only commands still render through their handler', async t => {
	const queued: React.ReactNode[] = [];
	await dispatchSlashCommand(
		'/nope-not-a-command',
		createOptions({onAddToChatQueue: node => queued.push(node)}),
	);
	await wait(0);
	t.true(
		queued.some(node =>
			queuedText(node).includes('Unknown command: nope-not-a-command'),
		),
	);
});

test('the registry proxy refuses to run a stateful command without context', async t => {
	const proxy = commandRegistry.get(probeCommand.name);
	await t.throwsAsync(
		proxy!.handler([], [], {
			provider: 'test',
			model: 'test',
			tokens: 0,
			getMessageTokens: () => 0,
		}),
		{message: /needs app state/},
	);
});
