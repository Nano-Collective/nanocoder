import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {cleanup, render} from 'ink-testing-library';
import React from 'react';
// CRITICAL: redirect preference writes to a temp dir BEFORE rendering the
// hook. The mount-effect runs createLLMClient → updateLastUsed which would
// otherwise overwrite the user's real preferences file.
process.env.NANOCODER_CONFIG_DIR = mkdtempSync(
	join(tmpdir(), 'nanocoder-spec-'),
);
const {resetPreferencesCache} = await import('@/config/preferences');
resetPreferencesCache();

import {CustomCommandLoader} from '@/custom-commands/loader';
import type {AIProviderConfig} from '@/types/config';
import type {
	LLMClient,
	LSPConnectionStatus,
	MCPConnectionStatus,
} from '@/types/core';
import type {CustomCommand, UpdateInfo} from '@/types/index';
import {useAppInitialization} from './useAppInitialization';

console.log('\nuseAppInitialization.spec.tsx');

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

interface ProbeOverrides {
	cliProvider?: string;
	cliModel?: string;
	nonInteractiveMode?: boolean;
	customCommandCache?: Map<string, CustomCommand>;
}

let captured: ReturnType<typeof useAppInitialization> | null = null;

function setup(overrides: ProbeOverrides = {}) {
	captured = null;

	const props = {
		setClient: spy<[LLMClient | null]>(),
		setCurrentModel: spy<[string]>(),
		setCurrentProvider: spy<[string]>(),
		setCurrentProviderConfig: spy<[AIProviderConfig | null]>(),
		setToolManager: spy<[unknown]>(),
		setCustomCommandLoader: spy<[unknown]>(),
		setCustomCommandExecutor: spy<[unknown]>(),
		setCustomCommandCache: spy<[Map<string, CustomCommand>]>(),
		setStartChat: spy<[boolean]>(),
		setMcpInitialized: spy<[boolean]>(),
		setUpdateInfo: spy<[UpdateInfo | null]>(),
		setMcpServersStatus: spy<[MCPConnectionStatus[]]>(),
		setLspServersStatus: spy<[LSPConnectionStatus[]]>(),
		setPreferencesLoaded: spy<[boolean]>(),
		setCustomCommandsCount: spy<[number]>(),
		setSubagentsReady: spy<[boolean]>(),
		addToChatQueue: spy<[React.ReactNode]>(),
		customCommandCache:
			overrides.customCommandCache ?? new Map<string, CustomCommand>(),
		setActiveMode: spy<[unknown]>(),
		cliProvider: overrides.cliProvider,
		cliModel: overrides.cliModel,
		nonInteractiveMode: overrides.nonInteractiveMode,
	};

	function Probe() {
		captured = useAppInitialization(props as never);
		return null;
	}

	const instance = render(<Probe />);
	if (!captured) throw new Error('useAppInitialization did not initialize');
	return {
		handlers: captured as ReturnType<typeof useAppInitialization>,
		instance,
		props,
	};
}

test.afterEach(() => {
	cleanup();
	captured = null;
});

// The hook's mount effect fires LSP/MCP/update-check work that holds the event
// loop open beyond test completion. Force-exit so the spec doesn't time out.
test.after.always(() => {
	setTimeout(() => process.exit(0), 100).unref();
});

test('returns the expected handler surface', t => {
	const {handlers} = setup();

	t.is(typeof handlers.initializeClient, 'function');
	t.is(typeof handlers.loadCustomCommands, 'function');
	t.is(typeof handlers.initializeMCPServers, 'function');
	t.is(typeof handlers.reinitializeMCPServers, 'function');
	t.is(typeof handlers.initializeLSPServers, 'function');
});

test('loadCustomCommands populates cache from loader and updates count', t => {
	const cache = new Map<string, CustomCommand>();
	const {handlers, props} = setup({customCommandCache: cache});

	const fakeCommand = {
		name: 'hello',
		description: 'say hi',
		metadata: {aliases: ['hi', 'greet']},
	} as CustomCommand;

	const loader = {
		loadCommands: () => {},
		getAllCommands: () => [fakeCommand],
	} as unknown as CustomCommandLoader;

	handlers.loadCustomCommands(loader);

	t.true(cache.has('hello'));
	t.true(cache.has('hi'));
	t.true(cache.has('greet'));
	t.is(cache.get('hello'), fakeCommand);
	t.deepEqual(props.setCustomCommandsCount.calls, [[1]]);
});

test('loadCustomCommands handles loaders without aliases', t => {
	const cache = new Map<string, CustomCommand>();
	const {handlers} = setup({customCommandCache: cache});

	const cmd = {name: 'no-alias'} as CustomCommand;
	const loader = {
		loadCommands: () => {},
		getAllCommands: () => [cmd],
	} as unknown as CustomCommandLoader;

	handlers.loadCustomCommands(loader);

	t.is(cache.size, 1);
	t.is(cache.get('no-alias'), cmd);
});

test('loadCustomCommands clears prior cache before reloading', t => {
	const cache = new Map<string, CustomCommand>();
	cache.set('stale', {name: 'stale'} as CustomCommand);

	const {handlers} = setup({customCommandCache: cache});

	const loader = {
		loadCommands: () => {},
		getAllCommands: () => [{name: 'fresh'} as CustomCommand],
	} as unknown as CustomCommandLoader;

	handlers.loadCustomCommands(loader);

	t.false(cache.has('stale'));
	t.true(cache.has('fresh'));
});

test('loadCustomCommands handles loaders that return undefined', t => {
	const cache = new Map<string, CustomCommand>();
	const {handlers, props} = setup({customCommandCache: cache});

	const loader = {
		loadCommands: () => {},
		getAllCommands: () => undefined,
	} as unknown as CustomCommandLoader;

	handlers.loadCustomCommands(loader);

	t.is(cache.size, 0);
	t.deepEqual(props.setCustomCommandsCount.calls, [[0]]);
});
