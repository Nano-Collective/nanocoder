import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import type {Message} from '../types/core';
import {resetKeyGeneratorForTests} from './key-generator';
import {buildSessionHistoryComponents} from './session-history-renderer';

function TestThemeProvider({children}: {children: React.ReactNode}) {
	const themeContextValue = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};
	return (
		<ThemeContext.Provider value={themeContextValue}>
			{children}
		</ThemeContext.Provider>
	);
}

function renderHistory(messages: Message[], model = 'test-model'): string {
	const components = buildSessionHistoryComponents(messages, model);
	const {lastFrame} = render(
		<TestThemeProvider>
			<>{components}</>
		</TestThemeProvider>,
	);
	return lastFrame() ?? '';
}

test.beforeEach(() => {
	resetKeyGeneratorForTests();
});

test('renders user prompts and assistant replies', t => {
	const messages: Message[] = [
		{role: 'system', content: 'system prompt that should not appear'},
		{role: 'user', content: 'fix the parser bug'},
		{role: 'assistant', content: 'Sure, looking into the parser now.'},
	];

	const output = renderHistory(messages);

	t.regex(output, /fix the parser bug/);
	t.regex(output, /looking into the parser/);
	t.notRegex(output, /system prompt that should not appear/);
});

test('renders tool calls as compact summaries paired with results', t => {
	const messages: Message[] = [
		{role: 'user', content: 'read the config'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_1',
					function: {
						name: 'read_file',
						arguments: {path: 'source/config/index.ts'},
					},
				},
			],
		},
		{
			role: 'tool',
			tool_call_id: 'call_1',
			name: 'read_file',
			content: 'file contents here',
		},
	];

	const output = renderHistory(messages);

	t.regex(output, /read_file/);
	t.regex(output, /source\/config\/index\.ts/);
	t.notRegex(output, /failed/);
});

test('marks failed tool calls', t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_err',
					function: {name: 'execute_bash', arguments: {command: 'ls /nope'}},
				},
			],
		},
		{
			role: 'tool',
			tool_call_id: 'call_err',
			name: 'execute_bash',
			content: 'Error: no such file or directory',
		},
	];

	const output = renderHistory(messages);

	t.regex(output, /execute_bash/);
	t.regex(output, /failed/);
});

test('truncates long histories and notes hidden messages', t => {
	const messages: Message[] = [];
	for (let i = 0; i < 80; i++) {
		messages.push({role: 'user', content: `message number ${i}`});
	}

	const output = renderHistory(messages);

	t.regex(output, /earlier messages hidden/);
	// Earliest messages are dropped, most recent are kept.
	t.notRegex(output, /message number 0\b/);
	t.regex(output, /message number 79/);
});

test('renders nothing meaningful for an empty session', t => {
	const components = buildSessionHistoryComponents([], 'test-model');
	t.is(components.length, 0);
});

test('renders assistant reasoning collapsed', t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: 'Done.',
			reasoning: 'first I considered the secret approach',
		},
	];

	const output = renderHistory(messages);

	t.regex(output, /Thought/);
	// Collapsed: the reasoning body itself is not shown.
	t.notRegex(output, /secret approach/);
});
