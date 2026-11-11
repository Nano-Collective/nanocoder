import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';
import {commandRegistry} from '@/commands';
import {runCheckpointSubcommand} from '@/commands/checkpoint';
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

test.serial('built-in names match in any case', async t => {
	const calls: string[] = [];
	const options = createOptions({
		onShowStatus: () => calls.push('status'),
		onEnterSettingsMode: tab => calls.push(`settings:${tab ?? ''}`),
		onEnterModelDatabaseMode: () => calls.push('model-database'),
	});
	await dispatchSlashCommand('/STATUS', options);
	await dispatchSlashCommand('/Setup-MCP', options);
	await dispatchSlashCommand('/Model-Database', {...options, commandArgs: []});
	t.deepEqual(calls, ['status', 'settings:mcp', 'model-database']);
});

test.serial('/sessions and /history open the session picker through the alias table', async t => {
	for (const message of ['/sessions', '/History --all']) {
		const showAll: Array<boolean | undefined> = [];
		await dispatchSlashCommand(
			message,
			createOptions({
				onEnterSessionSelectorMode: all => showAll.push(all),
				onResumeSession: () => {},
			}),
		);
		t.deepEqual(showAll, [message.includes('--all') ? true : undefined], message);
	}
});

test.serial('a project command keeps matching its exact name', async t => {
	let status = 0;
	let completed = false;
	const customCommandCache = new Map([
		['Status', {name: 'Status', fullName: 'Status'}],
	]) as unknown as MessageSubmissionOptions['customCommandCache'];
	const options = createOptions({
		customCommandCache,
		onShowStatus: () => status++,
		onCommandComplete: () => {
			completed = true;
		},
	});
	await dispatchSlashCommand('/Status', options);
	t.is(status, 0, 'the project command wins for its own spelling');
	t.true(completed);
	await dispatchSlashCommand('/STATUS', options);
	t.is(status, 1, 'any other spelling is the built-in');
});

test.serial('/retry hands off to the chat turn and does not complete itself', async t => {
	const submitted: string[] = [];
	let completed = 0;
	await dispatchSlashCommand(
		'/retry',
		createOptions({
			messages: [{role: 'user', content: 'retry me'}],
			onHandleChatMessage: async message => {
				submitted.push(message);
			},
			onCommandComplete: () => completed++,
		}),
	);
	await wait(DELAY_COMMAND_COMPLETE_MS + 25);
	t.deepEqual(submitted, ['retry me']);
	t.is(completed, 0, 'the retried turn signals completion, not the command');
});

test.serial('/retry keeps a quoted --model value whole', async t => {
	const switches: string[] = [];
	await dispatchSlashCommand(
		'/retry --model "my model" --provider local',
		createOptions({
			messages: [{role: 'user', content: 'again'}],
			onSwitchModel: async (provider, model) => {
				switches.push(`${provider}/${model}`);
				return true;
			},
		}),
	);
	t.deepEqual(switches, ['local/my model']);
});

test.serial('/checkpoint load picks from a list, or says there is none', async t => {
	const originalCwd = process.cwd();
	const workspace = mkdtempSync(join(tmpdir(), 'dispatcher-checkpoint-'));
	process.chdir(workspace);
	try {
		const queued: React.ReactNode[] = [];
		let completed = 0;
		const picked: number[] = [];
		const messages: Message[] = [{role: 'user', content: 'hi'}];
		const options = createOptions({
			messages,
			onAddToChatQueue: node => queued.push(node),
			onCommandComplete: () => completed++,
			onEnterCheckpointLoadMode: (checkpoints, count) =>
				picked.push(checkpoints.length, count),
		});

		await dispatchSlashCommand('/checkpoint load', options);
		t.true(queuedText(queued[0]).includes('No checkpoints available'));
		t.is(completed, 1);

		await runCheckpointSubcommand(['create', 'first'], messages, {
			provider: 'test',
			model: 'test',
		});
		await dispatchSlashCommand('/checkpoint restore', options);
		t.deepEqual(picked, [1, 1]);
		await wait(DELAY_COMMAND_COMPLETE_MS + 25);
		t.is(completed, 1, 'the picker completes the command, not the dispatcher');
	} finally {
		process.chdir(originalCwd);
		rmSync(workspace, {recursive: true, force: true});
	}
});

test.serial('other /checkpoint subcommands show their output like a read-only command', async t => {
	const queued: React.ReactNode[] = [];
	let completed = false;
	await dispatchSlashCommand(
		'/checkpoint help',
		createOptions({
			onAddToChatQueue: node => queued.push(node),
			onCommandComplete: () => {
				completed = true;
			},
		}),
	);
	await wait(0);
	t.true(React.isValidElement(queued[0]));
	t.false(completed);
	await wait(DELAY_COMMAND_COMPLETE_MS + 25);
	t.true(completed);
});

test.serial('/stats completes only when its live card closes', async t => {
	let live: React.ReactNode = null;
	const capture: boolean[] = [];
	let completed = 0;
	await dispatchSlashCommand(
		'/stats 3m',
		createOptions({
			setLiveComponent: node => {
				live = node;
			},
			setLiveComponentCapturesInput: value => capture.push(value),
			onCommandComplete: () => completed++,
		}),
	);
	await wait(DELAY_COMMAND_COMPLETE_MS + 25);
	t.is(completed, 0, 'the card is still open');
	t.deepEqual(capture, [true]);

	(live as React.ReactElement<{onClose: () => void}>).props.onClose();
	await wait(0);
	t.is(live, null);
	t.deepEqual(capture, [true, false]);
	t.is(completed, 1);
});

test.serial('/login copilot completes when the device flow finishes', async t => {
	let live: React.ReactNode = null;
	const executing: boolean[] = [];
	const queued: React.ReactNode[] = [];
	let completed = 0;
	await dispatchSlashCommand(
		'/login COPILOT Work Copilot',
		createOptions({
			setLiveComponent: node => {
				live = node;
			},
			setIsToolExecuting: value => executing.push(value),
			onAddToChatQueue: node => queued.push(node),
			onCommandComplete: () => completed++,
		}),
	);
	const element = live as React.ReactElement<{
		providerName: string;
		onDone: (result: {success: boolean; error?: string}) => void;
	}>;
	t.is(element.props.providerName, 'Work Copilot');
	t.deepEqual(executing, [true]);
	t.is(completed, 0);

	element.props.onDone({success: false, error: 'denied'});
	await wait(0);
	t.is(live, null);
	t.deepEqual(executing, [true, false]);
	t.is(queuedText(queued[0]), 'denied');
	t.is(completed, 1);
});

test.serial('/login without a known target shows its usage like a read-only command', async t => {
	const queued: React.ReactNode[] = [];
	let live = false;
	let completed = false;
	await dispatchSlashCommand(
		'/login github',
		createOptions({
			setLiveComponent: () => {
				live = true;
			},
			onAddToChatQueue: node => queued.push(node),
			onCommandComplete: () => {
				completed = true;
			},
		}),
	);
	await wait(0);
	t.false(live);
	t.true(queuedText(queued[0]).startsWith('Usage: /login <codex|copilot>'));
	t.false(completed);
	await wait(DELAY_COMMAND_COMPLETE_MS + 25);
	t.true(completed);
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
