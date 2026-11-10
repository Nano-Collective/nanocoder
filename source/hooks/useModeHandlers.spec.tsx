import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';
// CRITICAL: redirect preference writes to a temp dir BEFORE any production
// code reads `getPreferencesPath()`. handleModelSelect/handleTuneSelect call
// updateLastUsed/saveTune which would otherwise overwrite the user's real
// `~/Library/Preferences/nanocoder/nanocoder-preferences.json`.
process.env.NANOCODER_CONFIG_DIR = mkdtempSync(
	join(tmpdir(), 'nanocoder-spec-'),
);
const {resetPreferencesCache} = await import('@/config/preferences');
resetPreferencesCache();

import type {SettingsTabId} from '@/app/components/settings-constants';
import type {ActiveMode} from '@/hooks/useAppState';
import {
	resetSessionContextLimit,
	setSessionContextLimit,
} from '@/models/index';
import {readFileTool} from '@/tools/read-file';
import {clearReadTracker} from '@/utils/read-tracker';
import type {LLMClient, Message} from '@/types/core';
import type {AIProviderConfig, TuneConfig} from '@/types/config';
import {useModeHandlers} from './useModeHandlers';

console.log('\nuseModeHandlers.spec.tsx');

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

function createMockClient(model = 'mock-model'): LLMClient {
	let currentModel = model;
	return {
		getCurrentModel: () => currentModel,
		setModel: (m: string) => {
			currentModel = m;
		},
		getContextSize: () => 4096,
		getAvailableModels: async () => [currentModel],
		getProviderConfig: () =>
			({
				name: 'mock-provider',
				baseUrl: 'http://localhost',
				apiKey: 'test',
			}) as unknown as AIProviderConfig,
		chat: async () => ({
			message: {role: 'assistant', content: ''},
			messages: [],
			toolsDisabled: false,
		}),
		clearContext: async () => {},
		getTimeout: () => undefined,
	};
}

interface ProbeProps {
	client?: LLMClient | null;
	currentModel?: string;
	currentProvider?: string;
	messages?: Message[];
}

function setup(probe: ProbeProps = {}) {
	const setClient = spy<[LLMClient | null]>();
	const setCurrentModel = spy<[string]>();
	const setCurrentProvider = spy<[string]>();
	const setCurrentProviderConfig = spy<[AIProviderConfig | null]>();
	const setMessages = spy<[Message[]]>();
	const setActiveMode = spy<[ActiveMode]>();
	const setIsSettingsMode = spy<[boolean]>();
	const setSettingsActiveTab = spy<[SettingsTabId | undefined]>();
	const addToChatQueue = spy<[React.ReactNode]>();
	const reinitializeMCPServers = spy<[unknown]>();
	const setTune = spy<[TuneConfig]>();

	const handlers = useModeHandlers({
		client: probe.client ?? null,
		currentModel: probe.currentModel ?? 'current-model',
		currentProvider: probe.currentProvider ?? 'current-provider',
		setClient,
		setCurrentModel,
		setCurrentProvider,
		setCurrentProviderConfig,
		setMessages,
		messages: probe.messages ?? [],
		getMessageTokens: m => m.content.length,
		setActiveMode,
		setIsSettingsMode,
		setSettingsActiveTab,
		addToChatQueue,
		reinitializeMCPServers: async () => {
			reinitializeMCPServers(undefined);
		},
		setTune,
	});

	return {
		handlers,
		setClient,
		setCurrentModel,
		setCurrentProvider,
		setCurrentProviderConfig,
		setMessages,
		setActiveMode,
		setIsSettingsMode,
		setSettingsActiveTab,
		addToChatQueue,
		setTune,
	};
}

test('returns the expected handler surface', t => {
	const {handlers} = setup();

	t.is(typeof handlers.enterMode, 'function');
	t.is(typeof handlers.exitMode, 'function');
	t.is(typeof handlers.enterModelSelectionMode, 'function');
	t.is(typeof handlers.enterModelDatabaseMode, 'function');
	t.is(typeof handlers.enterExplorerMode, 'function');
	t.is(typeof handlers.enterIdeSelectionMode, 'function');
	t.is(typeof handlers.enterSettingsMode, 'function');
	t.is(typeof handlers.enterTune, 'function');
	t.is(typeof handlers.handleModelSelect, 'function');
	t.is(typeof handlers.handleConfigWizardComplete, 'function');
	t.is(typeof handlers.handleTuneSelect, 'function');
});

test('enterMode forwards to setActiveMode', t => {
	const {handlers, setActiveMode} = setup();

	handlers.enterMode('model');
	handlers.enterMode('modelDatabase');

	t.deepEqual(setActiveMode.calls, [['model'], ['modelDatabase']]);
});

test('exitMode sets active mode to null', t => {
	const {handlers, setActiveMode} = setup();

	handlers.exitMode();

	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('each enter*Mode helper sets the matching active mode', t => {
	const {handlers, setActiveMode} = setup();

	handlers.enterModelSelectionMode();
	handlers.enterModelDatabaseMode();
	handlers.enterExplorerMode();
	handlers.enterIdeSelectionMode();
	handlers.enterTune();

	t.deepEqual(setActiveMode.calls, [
		['model'],
		['modelDatabase'],
		['explorer'],
		['ideSelection'],
		['tune'],
	]);
});

test('enterSettingsMode toggles settings flag, handleSettingsCancel clears it', t => {
	const {handlers, setIsSettingsMode} = setup();

	handlers.enterSettingsMode();
	handlers.handleSettingsCancel();

	t.deepEqual(setIsSettingsMode.calls, [[true], [false]]);
});

test('cancel handlers all return active mode to null', t => {
	const {handlers, setActiveMode} = setup();

	handlers.handleModelSelectionCancel();
	handlers.handleModelDatabaseCancel();
	handlers.handleConfigWizardCancel();
	handlers.handleExplorerCancel();
	handlers.handleIdeSelectionCancel();
	handlers.handleTuneCancel();

	t.is(setActiveMode.calls.length, 6);
	for (const args of setActiveMode.calls) {
		t.deepEqual(args, [null]);
	}
});

test('handleModelSelect short-circuits when provider and model are unchanged', async t => {
	const client = createMockClient('current-model');
	const {handlers, setCurrentModel, setMessages, setActiveMode, addToChatQueue} =
		setup({
			client,
			currentProvider: 'current-provider',
			currentModel: 'current-model',
		});

	await handlers.handleModelSelect('current-provider', 'current-model');

	t.is(setCurrentModel.calls.length, 0);
	t.is(setMessages.calls.length, 0);
	t.is(addToChatQueue.calls.length, 0);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('handleModelSelect with new model on same provider updates client, keeps history, exits mode', async t => {
	const client = createMockClient('old-model');
	const {handlers, setCurrentModel, setMessages, setActiveMode, addToChatQueue} =
		setup({
			client,
			currentProvider: 'current-provider',
			currentModel: 'old-model',
		});

	await handlers.handleModelSelect('current-provider', 'new-model');

	t.is(client.getCurrentModel(), 'new-model');
	t.deepEqual(setCurrentModel.calls, [['new-model']]);
	// History is preserved across model switches.
	t.is(setMessages.calls.length, 0);
	t.is(addToChatQueue.calls.length, 1);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('handleModelSelect on same provider with no client only exits mode', async t => {
	const {handlers, setCurrentModel, setMessages, setActiveMode} = setup({
		client: null,
		currentProvider: 'current-provider',
	});

	await handlers.handleModelSelect('current-provider', 'any-model');

	t.is(setCurrentModel.calls.length, 0);
	t.is(setMessages.calls.length, 0);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test.serial('handleModelSelect on another provider builds a client for it', async t => {
	process.env.NANOCODER_PROVIDERS = JSON.stringify([
		{
			name: 'other-provider',
			baseUrl: 'http://127.0.0.1:9/v1',
			apiKey: 'test',
			models: ['other-model'],
		},
	]);
	try {
		const client = createMockClient('current-model');
		const {handlers, setClient, setCurrentProvider, setCurrentModel} = setup({
			client,
		});

		t.true(
			await handlers.handleModelSelect('other-provider', 'other-model', true),
		);

		t.is(setClient.calls.length, 1);
		const newClient = setClient.calls[0]![0]!;
		t.not(newClient, client);
		t.is(newClient.getCurrentModel(), 'other-model');
		t.deepEqual(setCurrentProvider.calls, [['other-provider']]);
		t.deepEqual(setCurrentModel.calls, [['other-model']]);
	} finally {
		delete process.env.NANOCODER_PROVIDERS;
	}
});

test.serial('handleModelSelect keeps the current client and labels when the provider is gone', async t => {
	const client = createMockClient('current-model');
	const {handlers, setClient, setCurrentProvider, setCurrentModel, addToChatQueue} =
		setup({client});

	t.false(
		await handlers.handleModelSelect('gone-provider', 'gone-model', true),
	);

	t.is(setClient.calls.length, 0);
	t.is(setCurrentProvider.calls.length, 0);
	t.is(setCurrentModel.calls.length, 0);
	t.is(client.getCurrentModel(), 'current-model');
	t.is(addToChatQueue.calls.length, 1, 'reports why it did not switch');
});

test.serial('handleModelSelect sizes the history it is given, not the current one', async t => {
	// /resume hands over the resumed session's messages: that is what the new
	// model continues, while `messages` still holds the conversation being left.
	const long: Message[] = [{role: 'user', content: 'x'.repeat(100)}];
	const short: Message[] = [{role: 'user', content: 'short'}];
	setSessionContextLimit(50);
	try {
		const leaving = setup({
			client: createMockClient('old-model'),
			currentModel: 'old-model',
			messages: long,
		});
		await leaving.handlers.handleModelSelect(
			'current-provider',
			'new-model',
			true,
			short,
		);
		t.is(leaving.addToChatQueue.calls.length, 0);

		const resuming = setup({
			client: createMockClient('old-model'),
			currentModel: 'old-model',
			messages: short,
		});
		await resuming.handlers.handleModelSelect(
			'current-provider',
			'new-model',
			true,
			long,
		);
		t.is(resuming.addToChatQueue.calls.length, 1);
		const warning = resuming.addToChatQueue.calls[0]![0] as React.ReactElement;
		t.true(String(warning.key).includes('-model-context-overflow-'));
	} finally {
		resetSessionContextLimit();
	}
});

test('handleTuneSelect persists tune, clears history, and exits mode', async t => {
	const client = createMockClient();
	const {handlers, setTune, setMessages, setActiveMode, addToChatQueue} = setup(
		{client},
	);

	const config: TuneConfig = {
		enabled: true,
		toolProfile: 'minimal',
		aggressiveCompact: false,
	} as unknown as TuneConfig;

	await handlers.handleTuneSelect(config);

	t.deepEqual(setTune.calls, [[config]]);
	t.deepEqual(setMessages.calls, [[[]]]);
	t.is(addToChatQueue.calls.length, 1);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('handleTuneSelect with disabled config still clears chat and exits', async t => {
	const {handlers, setTune, setMessages, setActiveMode, addToChatQueue} = setup();

	const config: TuneConfig = {
		enabled: false,
		toolProfile: 'minimal',
		aggressiveCompact: false,
	} as unknown as TuneConfig;

	await handlers.handleTuneSelect(config);

	t.deepEqual(setTune.calls, [[config]]);
	t.deepEqual(setMessages.calls, [[[]]]);
	t.is(addToChatQueue.calls.length, 1);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('handleConfigWizardComplete with no path only exits mode', async t => {
	const {handlers, setActiveMode, addToChatQueue} = setup();

	await handlers.handleConfigWizardComplete();

	t.deepEqual(setActiveMode.calls, [[null]]);
	t.is(addToChatQueue.calls.length, 0);
});

test('reloadProviders leaves the conversation and settings panel intact', async t => {
	const {
		handlers,
		setMessages,
		setActiveMode,
		setIsSettingsMode,
		addToChatQueue,
	} = setup({client: createMockClient()});

	await handlers.reloadProviders();

	// This is why reloadProviders exists rather than reusing
	// handleConfigWizardComplete: editing a provider mid-session must not wipe
	// the model's history or tear down the settings panel around the user.
	// These hold whether the rebuild succeeds or fails - handleConfigWizardComplete
	// would have called exitMode() before it ever reached the client swap.
	t.is(setMessages.calls.length, 0, 'conversation history is left alone');
	t.is(setActiveMode.calls.length, 0, 'does not exit the current mode');
	t.is(setIsSettingsMode.calls.length, 0, 'leaves the settings panel open');
	t.is(addToChatQueue.calls.length, 1, 'reports the outcome exactly once');
});

async function withReadStub(
	t: import('ava').ExecutionContext,
	clearHistory: () => Promise<unknown>,
) {
	clearReadTracker();
	const dir = join(process.cwd(), `mode-read-stub-${Date.now()}`);
	mkdirSync(dir, {recursive: true});
	const file = join(dir, 'kept.ts');
	writeFileSync(file, 'export const kept = 1;\n');
	const read = () =>
		readFileTool.tool.execute!(
			{path: file},
			{toolCallId: 'read', messages: []},
		) as Promise<string>;
	try {
		t.true((await read()).includes('kept = 1'));
		t.true((await read()).includes('already in context'));
		await clearHistory();
		t.true((await read()).includes('kept = 1'));
	} finally {
		clearReadTracker();
		rmSync(dir, {recursive: true, force: true});
	}
}

test.serial('handleTuneSelect makes the next read_file return the file', async t => {
	const {handlers} = setup();
	await withReadStub(t, () =>
		handlers.handleTuneSelect({
			enabled: false,
			toolProfile: 'minimal',
			aggressiveCompact: false,
		} as unknown as TuneConfig),
	);
});

test.serial(
	'handleConfigWizardComplete makes the next read_file return the file',
	async t => {
		process.env.NANOCODER_PROVIDERS = JSON.stringify({
			providers: [
				{
					name: 'LocalTest',
					baseUrl: 'http://localhost:8000/v1',
					models: ['test-model'],
				},
			],
		});
		const {handlers, setMessages} = setup();
		try {
			await withReadStub(t, () =>
				handlers.handleConfigWizardComplete('agents.config.json'),
			);
			t.deepEqual(setMessages.calls, [[[]]]);
		} finally {
			delete process.env.NANOCODER_PROVIDERS;
		}
	},
);

test('enterSettingsMode forwards the requested tab', t => {
	const {handlers, setSettingsActiveTab} = setup();

	handlers.enterSettingsMode('mcp');
	handlers.enterSettingsMode();

	t.deepEqual(setSettingsActiveTab.calls, [['mcp'], [undefined]]);
});
