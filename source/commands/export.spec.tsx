import test from 'ava';
import type {Message} from '@/types/index';
import {exportCommand} from './export';
import {promises as fs} from 'fs';
import React from 'react';
import {render} from 'ink-testing-library';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';

// Mock fs module
const originalWriteFile = fs.writeFile;
let mockWriteFileCalls: Array<{path: string; content: string}> = [];

test.beforeEach(() => {
	mockWriteFileCalls = [];
	fs.writeFile = async (filepath: string, content: string) => {
		mockWriteFileCalls.push({path: filepath, content});
		return Promise.resolve(void 0);
	};
});

test.afterEach(() => {
	fs.writeFile = originalWriteFile;
});

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

const testMessages: Message[] = [
	{role: 'user', content: 'Hello'},
	{role: 'assistant', content: 'Hi there', tool_calls: undefined},
	{role: 'tool', name: 'test', content: 'Tool result'},
	{role: 'system', content: 'System message'},
];

const testMetadata = {
	provider: 'test-provider',
	model: 'test-model',
	tokens: 100,
	getMessageTokens: (m: Message) => 0,
};

test('exportCommand has correct name and description', t => {
	t.is(exportCommand.name, 'export');
	t.is(exportCommand.description, 'Export the chat history to a markdown file');
});

test('exportCommand handler returns React element', async t => {
	const result = await exportCommand.handler([], testMessages, testMetadata);
	t.truthy(React.isValidElement(result));
});

test('exportCommand uses provided filename', async t => {
	await exportCommand.handler(['custom-export.md'], testMessages, testMetadata);

	t.is(mockWriteFileCalls.length, 1);
	t.true(mockWriteFileCalls[0].path.includes('custom-export.md'));
});

test('exportCommand generates default filename when none provided', async t => {
	await exportCommand.handler([], testMessages, testMetadata);

	t.is(mockWriteFileCalls.length, 1);
	t.true(mockWriteFileCalls[0].path.includes('nanocoder-chat-'));
	t.true(mockWriteFileCalls[0].path.endsWith('.md'));
});

test('exportCommand includes frontmatter in export', async t => {
	await exportCommand.handler(['test.md'], testMessages, testMetadata);

	const content = mockWriteFileCalls[0].content;
	t.true(content.includes('session_date:'));
	t.true(content.includes('provider: test-provider'));
	t.true(content.includes('model: test-model'));
	t.true(content.includes('total_tokens: 100'));
});

test('exportCommand formats user messages correctly', async t => {
	const messages: Message[] = [{role: 'user', content: 'Hello world'}];
	await exportCommand.handler(['test.md'], messages, testMetadata);

	const content = mockWriteFileCalls[0].content;
	t.true(content.includes('## User'));
	t.true(content.includes('Hello world'));
});

test('exportCommand formats assistant messages correctly', async t => {
	const messages: Message[] = [{role: 'assistant', content: 'Assistant response'}];
	await exportCommand.handler(['test.md'], messages, testMetadata);

	const content = mockWriteFileCalls[0].content;
	t.true(content.includes('## Assistant'));
	t.true(content.includes('Assistant response'));
});

test('exportCommand formats assistant messages with empty content', async t => {
	const messages: Message[] = [{role: 'assistant', content: ''}];
	await exportCommand.handler(['test.md'], messages, testMetadata);

	const content = mockWriteFileCalls[0].content;
	t.true(content.includes('## Assistant'));
	// Should have empty content after the header
	t.true(content.includes('## Assistant\n\n'));
});

test('exportCommand formats assistant messages with undefined content', async t => {
	const messages: Message[] = [
		{role: 'assistant', content: undefined as unknown as string},
	];
	await exportCommand.handler(['test.md'], messages, testMetadata);

	const content = mockWriteFileCalls[0].content;
	t.true(content.includes('## Assistant'));
	// Should handle undefined content gracefully
});

test('exportCommand formats assistant messages with tool calls', async t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: 'Using tools',
			tool_calls: [
				{function: {name: 'tool1', arguments: '{}'}, id: '1'},
				{function: {name: 'tool2', arguments: '{}'}, id: '2'},
			],
		},
	];
	await exportCommand.handler(['test.md'], messages, testMetadata);

	const content = mockWriteFileCalls[0].content;
	t.true(content.includes('[tool_use: tool1, tool2]'));
});

test('exportCommand formats tool messages correctly', async t => {
	const messages: Message[] = [{role: 'tool', name: 'my_tool', content: 'Tool output'}];
	await exportCommand.handler(['test.md'], messages, testMetadata);

	const content = mockWriteFileCalls[0].content;
	t.true(content.includes('## Tool Output: my_tool'));
	t.true(content.includes('```'));
	t.true(content.includes('Tool output'));
});

test('exportCommand excludes system messages', async t => {
	const messages: Message[] = [{role: 'system', content: 'System instruction'}];
	await exportCommand.handler(['test.md'], messages, testMetadata);

	const content = mockWriteFileCalls[0].content;
	t.false(content.includes('System instruction'));
});

test('exportCommand handles unknown message role', async t => {
	const messages: Message[] = [{role: 'unknown' as const, content: 'Unknown'}];
	await exportCommand.handler(['test.md'], messages, testMetadata);

	// Should not throw, just handle gracefully
	t.is(mockWriteFileCalls.length, 1);
});

test('exportCommand renders Export component with correct filename', async t => {
	const result = await exportCommand.handler(
		['my-export.md'],
		testMessages,
		testMetadata,
	);

	// Render the result to execute the Export component
	if (React.isValidElement(result)) {
		const {lastFrame} = render(
			<MockThemeProvider>{result}</MockThemeProvider>,
		);
		const output = lastFrame();

		// Verify the output contains the filename
		t.truthy(output);
		t.regex(output!, /my-export\.md/);
	}
});
