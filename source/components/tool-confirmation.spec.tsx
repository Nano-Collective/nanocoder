import test, {type ExecutionContext} from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {setToolManagerGetter} from '../message-handler';
import type {ToolManager} from '../tools/tool-manager';
import type {ToolCall} from '../types/core';
import ToolConfirmation from './tool-confirmation';

console.log('\ntool-confirmation.spec.tsx');

// Mock ThemeProvider for testing
const MockThemeProvider = ({children}: {children: React.ReactNode}) => {
	const mockTheme = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={mockTheme}>{children}</ThemeContext.Provider>
	);
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const SCHEMA_TOOL = {
	inputSchema: {
		jsonSchema: {
			type: 'object',
			properties: {
				path: {type: 'string'},
			},
		},
	},
};

type MockManagerOverrides = {
	getMCPToolInfo?: ToolManager['getMCPToolInfo'];
	getToolEntry?: ToolManager['getToolEntry'];
	getToolValidator?: ToolManager['getToolValidator'];
	getToolFormatter?: ToolManager['getToolFormatter'];
};

function mockToolManager(overrides: MockManagerOverrides = {}): ToolManager {
	return {
		getMCPToolInfo: () => ({isMCPTool: false}),
		getToolEntry: () => ({tool: SCHEMA_TOOL}),
		getToolValidator: () => undefined,
		getToolFormatter: () => undefined,
		...overrides,
	} as unknown as ToolManager;
}

type ConfirmationRecord = {
	confirmations: boolean[];
	cancels: number[];
};

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
	return {
		id: 'call-1',
		function: {name, arguments: args},
	};
}

function mountConfirmation(
	t: ExecutionContext,
	overrides: MockManagerOverrides,
	args: Record<string, unknown>,
	name = 'schema_tool',
) {
	const record: ConfirmationRecord = {confirmations: [], cancels: []};
	setToolManagerGetter(() => mockToolManager(overrides));
	const app = render(
		<MockThemeProvider>
			<ToolConfirmation
				toolCall={toolCall(name, args)}
				onConfirm={confirmed => record.confirmations.push(confirmed)}
				onCancel={() => {
					record.cancels.push(1);
				}}
			/>
		</MockThemeProvider>,
	);
	t.teardown(() => {
		app.unmount();
		setToolManagerGetter(() => null);
	});
	return {...app, record};
}

// Wait until `predicate` holds or the window elapses. Long enough for the
// async preview/validation effect to settle and any auto-cancel to fire.
async function waitUntil(predicate: () => boolean, timeoutMs = 400) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) return;
		await sleep(20);
	}
}

test.before(() => {
	setToolManagerGetter(() => null);
});

test(
	'approval prompt is shown (not auto-approved) when arguments fail schema validation',
	async t => {
		const {lastFrame, record} = mountConfirmation(t, {}, {path: {nested: true}});

		// On the buggy behavior the auto-approve effect fires quickly, so the
		// loop stops as soon as a confirmation is recorded.
		await waitUntil(() => record.confirmations.length > 0);

		const frame = lastFrame();

		t.deepEqual(
			record.confirmations,
			[],
			'tool must not be auto-approved when its arguments fail schema validation',
		);
		t.regex(frame, /wrong type/i, 'validation error should be visible');
		t.regex(
			frame,
			/Do you want to execute tool/,
			'approval prompt must render together with the validation error',
		);
	},
);

test('approval prompt renders for well-typed arguments with no validation error', async t => {
	const {lastFrame, record} = mountConfirmation(t, {}, {path: 'a.txt'});

	// Let the (async) preview effect settle: a stray validation error would
	// have been rendered by the time this returns.
	await waitUntil(() => record.confirmations.length > 0);

	const frame = lastFrame();

	t.deepEqual(record.confirmations, [], 'well-typed tool must not auto-approve');
	t.regex(frame, /Do you want to execute tool/, 'approval prompt must render');
	t.false(/wrong type/i.test(frame), 'no validation error for well-typed args');
});

test('validator failure renders the error with the prompt and is not auto-approved', async t => {
	const {lastFrame, record} = mountConfirmation(
		t,
		{
			getToolValidator: () => async () => ({
				valid: false,
				error: 'path is not writable',
			}),
		},
		{path: 'a.txt'},
	);

	await waitUntil(() => record.confirmations.length > 0);

	const frame = lastFrame();

	t.deepEqual(
		record.confirmations,
		[],
		'validator-failing tool must not auto-approve',
	);
	t.regex(frame, /path is not writable/, 'validator error should be visible');
	t.regex(frame, /Do you want to execute tool/, 'approval prompt must render');
});

test('formatter crash auto-cancels without showing the approval prompt', async t => {
	const {lastFrame, record} = mountConfirmation(
		t,
		{
			getToolFormatter: () => async () => {
				throw new Error('boom');
			},
		},
		{path: 'a.txt'},
	);

	await waitUntil(() => record.confirmations.length > 0);

	const frame = lastFrame();

	t.deepEqual(record.confirmations, [false], 'formatter crash must auto-cancel');
	t.regex(
		frame,
		/cancelled due to formatter error/,
		'cancellation message should render',
	);
	t.false(
		/Do you want to execute tool/.test(frame),
		'approval prompt must not render',
	);
});

test('pressing Enter on the "No" option declines the tool', async t => {
	const {stdin, record} = mountConfirmation(t, {}, {path: 'a.txt'});

	// Move the highlight down to "No, cancel execution" and select it. Let the
	// highlight re-render before pressing Enter so the selection actually lands
	// on the second option rather than the still-highlighted "Yes".
	stdin.write('\u001B[B');
	await sleep(50);
	stdin.write('\r');

	await waitUntil(() => record.confirmations.length > 0);
	t.deepEqual(
		record.confirmations,
		[false],
		'selecting "No" must decline the tool',
	);
});

test('pressing Escape cancels the confirmation', async t => {
	const {stdin, record} = mountConfirmation(t, {}, {path: 'a.txt'});

	stdin.write('\u001B');

	await waitUntil(() => record.cancels.length > 0);
	t.deepEqual(record.cancels, [1], 'Escape must cancel the confirmation');
	t.deepEqual(record.confirmations, [], 'cancelling must not confirm the tool');
});

test('MCP tools render the server-qualified prompt', async t => {
	const {lastFrame, record} = mountConfirmation(
		t,
		{getMCPToolInfo: () => ({isMCPTool: true, serverName: 'weather'})},
		{path: 'a.txt'},
	);

	await waitUntil(() => record.confirmations.length > 0);

	const frame = lastFrame();
	t.regex(frame, /from server "weather"/, 'server name should be visible');
	t.regex(frame, /MCP tool "schema_tool"/, 'MCP tool should be labelled');
});
