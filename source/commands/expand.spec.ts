import test from 'ava';
import type React from 'react';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {ToolCall, ToolResult} from '@/types/core';
import {
	clearExpandableToolResults,
	recordExpandableToolResult,
} from '@/utils/tool-result-display';
import {expandCommand} from './expand';

const metadata = {
	provider: 'test-provider',
	model: 'test-model',
	tokens: 0,
	getMessageTokens: () => 0,
};

function record(
	name: string,
	args: Record<string, unknown>,
	content: string,
): number | undefined {
	const toolCall: ToolCall = {id: `call-${name}`, function: {name, arguments: args}};
	const result: ToolResult = {
		tool_call_id: toolCall.id,
		role: 'tool',
		name,
		content,
	};
	return recordExpandableToolResult(toolCall, result);
}

async function runExpand(args: string[]): Promise<string> {
	const element = await expandCommand.handler(args, [], metadata);
	const {lastFrame} = renderWithTheme(element as React.ReactElement);
	return lastFrame() ?? '';
}

test.beforeEach(() => {
	clearExpandableToolResults();
});

test('/expand says so when no tool has run yet', async t => {
	t.true((await runExpand([])).includes('No tool results to expand yet'));
});

test('/expand lists recent results with their numbers', async t => {
	const id = record('read_file', {path: 'src/app.ts'}, 'contents');

	const output = await runExpand([]);

	t.true(output.includes(`${id}  read_file src/app.ts`));
});

test('/expand <n> prints the whole result past the line cap', async t => {
	const content = Array.from({length: 30}, (_, i) => `line ${i + 1}`).join(
		'\n',
	);
	const id = record('mcp_tool', {}, content);

	const output = await runExpand([String(id)]);

	t.true(output.includes('line 30'));
	t.false(output.includes('more lines'));
});

test('/expand warns about a number it does not know', async t => {
	record('read_file', {path: 'a.ts'}, 'contents');

	t.true((await runExpand(['999'])).includes('No tool result 999'));
});

test('tools that are never collapsed get no /expand number', t => {
	t.is(record('write_tasks', {}, 'tasks'), undefined);
	t.is(record('ask_user', {}, 'answer'), undefined);
});
