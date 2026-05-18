import {mkdtempSync} from 'node:fs';
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

import type {ActiveMode} from '@/hooks/useAppState';
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
}

function setup(probe: ProbeProps = {}) {
	const setClient = spy<[LLMClient | null]>();
	const setCurrentModel = spy<[string]>();
	const setCurrentProvider = spy<[string]>();
	const setCurrentProviderConfig = spy<[AIProviderConfig | null]>();
	const setMessages = spy<[Message[]]>();
	const setActiveMode = spy<[ActiveMode]>();
	const setIsSettingsMode = spy<[boolean]>();
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
		setActiveMode,
		setIsSettingsMode,
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
		addToChatQueue,
		setTune,
	};
}

test('returns the expected handler surface', t => {
	const {handlers} = setup();

	t.is(typeof handlers.enterMode, 'function');
	t.is(typeof handlers.exitMode, 'function');
	t.is(typeof handlers.enterModelSelectionMode, 'function');
	t.is(typeof handlers.enterProviderSelectionMode, 'function');
	t.is(typeof handlers.enterModelDatabaseMode, 'function');
	t.is(typeof handlers.enterConfigWizardMode, 'function');
	t.is(typeof handlers.enterMcpWizardMode, 'function');
	t.is(typeof handlers.enterExplorerMode, 'function');
	t.is(typeof handlers.enterIdeSelectionMode, 'function');
	t.is(typeof handlers.enterSettingsMode, 'function');
	t.is(typeof handlers.enterTune, 'function');
	t.is(typeof handlers.handleModelSelect, 'function');
	t.is(typeof handlers.handleProviderSelect, 'function');
	t.is(typeof handlers.handleConfigWizardComplete, 'function');
	t.is(typeof handlers.handleMcpWizardComplete, 'function');
	t.is(typeof handlers.handleTuneSelect, 'function');
});

test('enterMode forwards to setActiveMode', t => {
	const {handlers, setActiveMode} = setup();

	handlers.enterMode('model');
	handlers.enterMode('provider');

	t.deepEqual(setActiveMode.calls, [['model'], ['provider']]);
});

test('exitMode sets active mode to null', t => {
	const {handlers, setActiveMode} = setup();

	handlers.exitMode();

	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('each enter*Mode helper sets the matching active mode', t => {
	const {handlers, setActiveMode} = setup();

	handlers.enterModelSelectionMode();
	handlers.enterProviderSelectionMode();
	handlers.enterModelDatabaseMode();
	handlers.enterConfigWizardMode();
	handlers.enterMcpWizardMode();
	handlers.enterExplorerMode();
	handlers.enterIdeSelectionMode();
	handlers.enterTune();

	t.deepEqual(setActiveMode.calls, [
		['model'],
		['provider'],
		['modelDatabase'],
		['configWizard'],
		['mcpWizard'],
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
	handlers.handleProviderSelectionCancel();
	handlers.handleModelDatabaseCancel();
	handlers.handleConfigWizardCancel();
	handlers.handleMcpWizardCancel();
	handlers.handleExplorerCancel();
	handlers.handleIdeSelectionCancel();
	handlers.handleTuneCancel();

	t.is(setActiveMode.calls.length, 8);
	for (const args of setActiveMode.calls) {
		t.deepEqual(args, [null]);
	}
});

test('handleModelSelect short-circuits when model is unchanged', async t => {
	const client = createMockClient('current-model');
	const {handlers, setCurrentModel, setMessages, setActiveMode, addToChatQueue} =
		setup({client, currentModel: 'current-model'});

	await handlers.handleModelSelect('current-model');

	t.is(setCurrentModel.calls.length, 0);
	t.is(setMessages.calls.length, 0);
	t.is(addToChatQueue.calls.length, 0);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('handleModelSelect with new model updates client, clears history, exits mode', async t => {
	const client = createMockClient('old-model');
	const {handlers, setCurrentModel, setMessages, setActiveMode, addToChatQueue} =
		setup({client, currentModel: 'old-model'});

	await handlers.handleModelSelect('new-model');

	t.is(client.getCurrentModel(), 'new-model');
	t.deepEqual(setCurrentModel.calls, [['new-model']]);
	t.deepEqual(setMessages.calls, [[[]]]);
	t.is(addToChatQueue.calls.length, 1);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('handleModelSelect with no client only exits mode', async t => {
	const {handlers, setCurrentModel, setMessages, setActiveMode} = setup({
		client: null,
	});

	await handlers.handleModelSelect('any-model');

	t.is(setCurrentModel.calls.length, 0);
	t.is(setMessages.calls.length, 0);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('handleProviderSelect short-circuits when provider is unchanged', async t => {
	const {handlers, setClient, setMessages, setActiveMode, addToChatQueue} =
		setup({currentProvider: 'current-provider'});

	await handlers.handleProviderSelect('current-provider');

	t.is(setClient.calls.length, 0);
	t.is(setMessages.calls.length, 0);
	t.is(addToChatQueue.calls.length, 0);
	t.deepEqual(setActiveMode.calls, [[null]]);
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

test('handleMcpWizardComplete with no path only exits mode', async t => {
	const {handlers, setActiveMode, addToChatQueue} = setup();

	await handlers.handleMcpWizardComplete();

	t.deepEqual(setActiveMode.calls, [[null]]);
	t.is(addToChatQueue.calls.length, 0);
});
