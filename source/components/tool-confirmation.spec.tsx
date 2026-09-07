import test from 'ava';
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

function mockToolManager(): ToolManager {
	return {
		getMCPToolInfo: () => ({isMCPTool: false}),
		getToolEntry: () => ({tool: SCHEMA_TOOL}),
		getToolValidator: () => undefined,
		getToolFormatter: () => undefined,
	} as unknown as ToolManager;
}

test.before(() => {
	setToolManagerGetter(() => null);
});

test(
	'approval prompt is shown (not auto-approved) when arguments fail schema validation',
	async t => {
		const confirmations: boolean[] = [];
		setToolManagerGetter(mockToolManager);

		const toolCall: ToolCall = {
			id: 'call-1',
			function: {
				name: 'schema_tool',
				arguments: {path: {nested: true}},
			},
		};

		const {lastFrame, unmount} = render(
			<MockThemeProvider>
				<ToolConfirmation
					toolCall={toolCall}
					onConfirm={confirmed => confirmations.push(confirmed)}
					onCancel={() => {}}
				/>
			</MockThemeProvider>,
		);
		t.teardown(() => {
			unmount();
			setToolManagerGetter(() => null);
		});

		// Let the (async) preview/validation effect settle. On the buggy
		// behavior this also lets the auto-approve effect fire, so the loop
		// stops as soon as a confirmation is recorded.
		for (let i = 0; i < 25 && confirmations.length === 0; i++) {
			await sleep(10);
		}

		const frame = lastFrame();

		t.deepEqual(
			confirmations,
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