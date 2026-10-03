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

test('/expand collapses multi-line arguments to one row', async t => {
	const id = record(
		'execute_bash',
		{command: 'for f in *.ts; do\n  cat "$f"\ndone'},
		'ok',
	);

	const output = await runExpand([]);

	t.true(output.includes(`${id}  execute_bash for f in *.ts; do cat "$f" done`));
	t.false(output.includes('\ndone'));
});

test('/expand truncates over-long arguments', async t => {
	const longPath = `${'a'.repeat(80)}.ts`;
	const id = record('read_file', {path: longPath}, 'contents');

	const output = await runExpand([]);

	t.true(output.includes('…'));
	t.false(output.includes(longPath));
});

test.serial('/expand pads the id column so tool names stay aligned', async t => {
	// Ids are global and never reset, so advance to a digit boundary (9 -> 10,
	// 99 -> 100) and list one result on each side of it.
	let id = record('read_file', {path: 'warmup.ts'}, 'x') ?? 0;
	while (String(id + 2).length === String(id + 1).length) {
		id = record('read_file', {path: 'warmup.ts'}, 'x') ?? 0;
	}
	clearExpandableToolResults();
	const shortId = record('read_file', {path: 'short.ts'}, 'x');
	const longId = record('read_file', {path: 'long.ts'}, 'x');
	t.true(String(longId).length > String(shortId).length);

	const lines = (await runExpand([])).split('\n');
	const shortRow = lines.find(line => line.includes('short.ts')) ?? '';
	const longRow = lines.find(line => line.includes('long.ts')) ?? '';

	t.true(shortRow.includes(` ${shortId}  read_file`));
	t.is(shortRow.indexOf('read_file'), longRow.indexOf('read_file'));
});

function summaryAtColumns(columns: number, longPath: string): Promise<string> {
	const original = process.stdout.columns;
	process.stdout.columns = columns;
	return runExpand([]).finally(() => {
		process.stdout.columns = original;
	});
}

test.serial('/expand cuts the argument to the terminal width', async t => {
	const longPath = `src/${'deep/'.repeat(40)}file.ts`;
	const id = record('read_file', {path: longPath}, 'contents');

	const narrow = await summaryAtColumns(60, longPath);
	const wide = await summaryAtColumns(160, longPath);

	// 60 columns: box 56, text 50. The row prefix "  <id>  read_file" and the
	// space before the argument leave 50 - 13 - idLength - 1 characters.
	const room = 50 - 13 - String(id).length - 1;
	t.true(narrow.includes(`read_file ${longPath.slice(0, room - 1)}…`));
	t.false(narrow.includes(longPath.slice(0, room)));
	// A wider terminal shows more of the same argument.
	t.true(wide.includes(longPath.slice(0, room + 20)));
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
