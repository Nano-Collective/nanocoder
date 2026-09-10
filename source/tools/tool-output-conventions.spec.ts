import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {clearReadTracker} from '../utils/read-tracker.js';
import {diffEditTool} from './file-ops/diff-edit.js';
import {stringReplaceTool} from './file-ops/string-replace.js';
import {writeFileTool} from './file-ops/write-file.js';
import {readFileTool} from './read-file.js';

// These tests guard the split documented in docs/features/tool-output-conventions.md:
// `read_file` returns raw content, bounded edit tools return absolute
// line-numbered windows, and `write_file` returns no file content at all.
// They assert on the strings the tools actually hand the model, so a tool that
// drifts from the doc fails here regardless of how it is implemented.

let testDir: string;

test.beforeEach(async () => {
	// Inside the project root: the edit tools reject paths outside it.
	testDir = await mkdtemp(join(process.cwd(), '.tool-output-conventions-'));
	// Read-before-edit state is process-global; reset it between serial tests.
	clearReadTracker();
});

test.afterEach(async () => {
	if (testDir) {
		await rm(testDir, {recursive: true, force: true});
	}
});

async function execute(
	// biome-ignore lint/suspicious/noExplicitAny: Tool internals require any
	toolExport: {tool: any},
	args: Record<string, unknown>,
): Promise<string> {
	return await toolExport.tool.execute(args, {
		toolCallId: 'test',
		messages: [],
	});
}

// A line-number gutter, as emitted by the bounded edit tools: `  47: line 47`.
const LINE_NUMBER_GUTTER = /^\s*\d+: /m;

const CONTEXT_HEADER = /Updated file context \(lines \d+-\d+ of \d+\):/;
const OMISSION_MARKER = /\[\.\.\. lines \d+-\d+ omitted \.\.\.\]/;

const searchMarker = '<'.repeat(7) + ' SEARCH';
const separatorMarker = '='.repeat(7);
const replaceMarker = '>'.repeat(7) + ' REPLACE';

function diffBlock(search: string, replace: string): string {
	return [searchMarker, search, separatorMarker, replace, replaceMarker].join(
		'\n',
	);
}

async function createNumberedFile(name: string): Promise<string> {
	const filePath = join(testDir, name);
	const content = Array.from(
		{length: 100},
		(_, index) => `line ${index + 1}`,
	).join('\n');
	await writeFile(filePath, content, 'utf-8');
	return filePath;
}

test('read_file returns raw content without line-number prefixes', async t => {
	const filePath = join(testDir, 'raw.txt');
	const content = Array.from(
		{length: 20},
		(_, index) => `raw line ${index + 1}`,
	).join('\n');
	await writeFile(filePath, content, 'utf-8');

	const result = await execute(readFileTool, {path: filePath});

	t.is(result, content);
	t.notRegex(result, LINE_NUMBER_GUTTER);
	t.notRegex(result, CONTEXT_HEADER);
});

test('string_replace keeps an absolute line-numbered context header', async t => {
	const filePath = await createNumberedFile('string-replace.txt');
	await execute(readFileTool, {path: filePath});

	const result = await execute(stringReplaceTool, {
		path: filePath,
		old_str: 'line 50',
		new_str: 'changed line 50',
	});

	t.regex(result, CONTEXT_HEADER);
	t.regex(result, OMISSION_MARKER);
	// Absolute file line numbers, not window-relative offsets.
	t.true(result.includes('  50: changed line 50'));
});

test('diff_edit keeps an absolute line-numbered context header', async t => {
	const filePath = await createNumberedFile('diff-edit.txt');
	await execute(readFileTool, {path: filePath});

	const result = await execute(diffEditTool, {
		path: filePath,
		diff: diffBlock('line 50', 'changed line 50'),
	});

	t.regex(result, CONTEXT_HEADER);
	t.regex(result, OMISSION_MARKER);
	t.true(result.includes('  50: changed line 50'));
});

test('write_file returns stats only, never file content', async t => {
	const filePath = join(testDir, 'written.txt');
	const content = 'sentinel content line\nsecond line';

	const result = await execute(writeFileTool, {path: filePath, content});

	t.false(result.includes('sentinel content line'));
	t.notRegex(result, LINE_NUMBER_GUTTER);
	t.notRegex(result, CONTEXT_HEADER);
});
