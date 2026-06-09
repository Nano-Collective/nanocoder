import test from 'ava';
import {cleanup, render} from 'ink-testing-library';
import React from 'react';
import type {Logger} from '@/utils/logging/types';
import {useAppLogging} from './useAppLogging';

console.log('\nuseAppLogging.spec.tsx');

interface LogCall {
	level: string;
	message: string;
	context?: unknown;
}

function makeLogger(): {logger: Logger; calls: LogCall[]} {
	const calls: LogCall[] = [];
	const record = (level: string) => (a: unknown, b?: unknown) => {
		if (typeof a === 'string') {
			calls.push({level, message: a, context: b});
		} else {
			calls.push({
				level,
				message: typeof b === 'string' ? b : '',
				context: a,
			});
		}
	};
	const logger = {
		fatal: record('fatal'),
		error: record('error'),
		warn: record('warn'),
		info: record('info'),
		http: record('http'),
		debug: record('debug'),
		trace: record('trace'),
		child: () => logger,
		isLevelEnabled: () => true,
		flush: async () => {},
		flushSync: () => {},
		end: async () => {},
	} as unknown as Logger;
	return {logger, calls};
}

interface ProbeProps {
	logger: Logger;
	mcpInitialized?: boolean;
	client?: unknown;
	updateInfo?: unknown;
	developmentMode?: string;
	vscodeMode?: boolean;
	activeMode?: string | null;
	isToolExecuting?: boolean;
	isToolConfirmationMode?: boolean;
	pendingToolCallsLength?: number;
	isGenerating?: boolean;
}

function setup(p: ProbeProps) {
	function Probe() {
		useAppLogging({
			logger: p.logger,
			vscodeMode: p.vscodeMode ?? false,
			vscodePort: undefined,
			developmentMode: p.developmentMode ?? 'normal',
			client: (p.client ?? null) as never,
			currentProvider: 'mock',
			currentModel: 'mock-model',
			toolManager: null,
			mcpInitialized: p.mcpInitialized ?? false,
			mcpServersStatus: [],
			updateInfo: (p.updateInfo ?? null) as never,
			activeMode: p.activeMode ?? null,
			isToolExecuting: p.isToolExecuting ?? false,
			isToolConfirmationMode: p.isToolConfirmationMode ?? false,
			pendingToolCallsLength: p.pendingToolCallsLength ?? 0,
			isGenerating: p.isGenerating ?? false,
		});
		return null;
	}
	return render(<Probe />);
}

test.afterEach(() => cleanup());

test('logs application startup with platform/pid context', t => {
	const {logger, calls} = makeLogger();
	setup({logger});

	const startup = calls.find(c => c.message === 'Nanocoder application starting');
	t.truthy(startup);
	t.is(startup!.level, 'info');
});

test('logs development mode change on mount', t => {
	const {logger, calls} = makeLogger();
	setup({logger, developmentMode: 'plan'});

	const change = calls.find(c => c.message === 'Development mode changed');
	t.truthy(change);
});

test('logs AI client init only once a client is present', t => {
	const {logger, calls} = makeLogger();
	setup({logger, client: null});

	t.false(calls.some(c => c.message === 'AI client initialized'));

	const {logger: l2, calls: c2} = makeLogger();
	setup({logger: l2, client: {fake: true}});
	t.true(c2.some(c => c.message === 'AI client initialized'));
});

test('logs MCP servers initialized only when mcpInitialized=true', t => {
	const {logger: noInitLogger, calls: noInit} = makeLogger();
	setup({logger: noInitLogger, mcpInitialized: false});
	t.false(noInit.some(c => c.message === 'MCP servers initialized'));

	const {logger, calls} = makeLogger();
	setup({logger, mcpInitialized: true});
	t.true(calls.some(c => c.message === 'MCP servers initialized'));
});

test('logs update info only when updateInfo is non-null', t => {
	const {logger: noUpdateLogger, calls: noUpdate} = makeLogger();
	setup({logger: noUpdateLogger, updateInfo: null});
	t.false(noUpdate.some(c => c.message === 'Update information available'));

	const {logger, calls} = makeLogger();
	setup({
		logger,
		updateInfo: {hasUpdate: true, currentVersion: '1.0.0', latestVersion: '1.1.0'},
	});
	t.true(calls.some(c => c.message === 'Update information available'));
});

test('logs interface ready when all gates open', t => {
	const {logger, calls} = makeLogger();
	setup({
		logger,
		mcpInitialized: true,
		client: {fake: true},
		isToolExecuting: false,
		isToolConfirmationMode: false,
		activeMode: null,
		pendingToolCallsLength: 0,
	});

	t.true(
		calls.some(
			c => c.message === 'Application interface ready for user interaction',
		),
	);
});

test('does not log interface ready when wizard mode is active', t => {
	const {logger, calls} = makeLogger();
	setup({
		logger,
		mcpInitialized: true,
		client: {fake: true},
		activeMode: 'configWizard',
	});

	t.false(
		calls.some(
			c => c.message === 'Application interface ready for user interaction',
		),
	);
});

test('does not log interface ready when a tool is executing', t => {
	const {logger, calls} = makeLogger();
	setup({
		logger,
		mcpInitialized: true,
		client: {fake: true},
		isToolExecuting: true,
	});

	t.false(
		calls.some(
			c => c.message === 'Application interface ready for user interaction',
		),
	);
});
