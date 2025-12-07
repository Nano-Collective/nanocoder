import test from 'ava';
import {executeBashTool} from './execute-bash.js';
import {readFileTool} from './read-file.js';
import {createFileTool} from './create-file.js';
import {writeFile, unlink, readFile} from 'fs/promises';
import {resolve} from 'path';
import {tmpdir} from 'os';

// ============================================================================
// Tests for AI SDK v6 Native Tools
// ============================================================================
// These tests validate that the native AI SDK tools work correctly with their
// execute functions. Since tools now only export the native AI SDK tool,
// there's no separate handler to compare against.

// ============================================================================
// Bash Execute Function
// ============================================================================

test('execute_bash tool works correctly', async t => {
	const result = (await executeBashTool.tool.execute!(
		{command: 'echo "test"'},
		{
			toolCallId: 'test-1',
			messages: [],
		},
	)) as string;

	t.truthy(result);
	t.regex(result, /test/);
});

test('execute_bash includes exit code', async t => {
	const result = (await executeBashTool.tool.execute!(
		{command: 'echo "success"'},
		{
			toolCallId: 'test-2',
			messages: [],
		},
	)) as string;

	t.truthy(result);
	t.regex(result, /EXIT_CODE: 0/);
});

test('execute_bash captures stderr', async t => {
	const result = (await executeBashTool.tool.execute!(
		{command: 'echo "error" >&2'},
		{
			toolCallId: 'test-3',
			messages: [],
		},
	)) as string;

	t.truthy(result);
	t.regex(result, /STDERR:/);
	t.regex(result, /error/);
});

test('execute_bash tool name constant is correct', t => {
	t.is(executeBashTool.name, 'execute_bash');
});

// ============================================================================
// Read File Execute Function
// ============================================================================

test('read_file reads existing file', async t => {
	const testFile = resolve(tmpdir(), `nanocoder-test-${Date.now()}.txt`);
	await writeFile(testFile, 'test content', 'utf-8');

	try {
		const result = (await readFileTool.tool.execute!(
			{path: testFile},
			{
				toolCallId: 'test-4',
				messages: [],
			},
		)) as string;

		t.truthy(result);
		t.regex(result, /test content/);
	} finally {
		await unlink(testFile).catch(() => {});
	}
});

test('read_file handles non-existent file', async t => {
	const nonExistentFile = resolve(tmpdir(), 'non-existent-file.txt');

	await t.throwsAsync(
		async () => {
			await readFileTool.tool.execute!(
				{path: nonExistentFile},
				{
					toolCallId: 'test-5',
					messages: [],
				},
			);
		},
		{message: /does not exist|no such file or directory|ENOENT/i},
	);
});

test('read_file reads with line ranges', async t => {
	const testFile = resolve(tmpdir(), `nanocoder-test-${Date.now()}.txt`);
	await writeFile(testFile, 'line1\nline2\nline3\nline4\nline5', 'utf-8');

	try {
		const result = (await readFileTool.tool.execute!(
			{path: testFile, start_line: 2, end_line: 4},
			{
				toolCallId: 'test-6',
				messages: [],
			},
		)) as string;

		t.truthy(result);
		t.regex(result, /line2/);
		t.regex(result, /line3/);
		t.regex(result, /line4/);
		t.notRegex(result, /line1/);
		t.notRegex(result, /line5/);
	} finally {
		await unlink(testFile).catch(() => {});
	}
});

test('read_file tool name constant is correct', t => {
	t.is(readFileTool.name, 'read_file');
});

// ============================================================================
// Create File Execute Function
// ============================================================================

test('create_file creates file', async t => {
	const testFile = resolve(tmpdir(), `nanocoder-test-${Date.now()}.txt`);

	try {
		const result = (await createFileTool.tool.execute!(
			{
				path: testFile,
				content: 'created by test',
			},
			{
				toolCallId: 'test-7',
				messages: [],
			},
		)) as string;

		t.is(result, 'File written successfully');

		// Verify file was created
		const content = await readFile(testFile, 'utf-8');
		t.is(content, 'created by test');
	} finally {
		await unlink(testFile).catch(() => {});
	}
});

test('create_file overwrites existing file', async t => {
	const testFile = resolve(tmpdir(), `nanocoder-test-${Date.now()}.txt`);

	try {
		// Create initial file
		await writeFile(testFile, 'old content', 'utf-8');

		// Overwrite with create_file
		const result = (await createFileTool.tool.execute!(
			{
				path: testFile,
				content: 'new content',
			},
			{
				toolCallId: 'test-8',
				messages: [],
			},
		)) as string;

		t.is(result, 'File written successfully');

		// Verify file was overwritten
		const content = await readFile(testFile, 'utf-8');
		t.is(content, 'new content');
	} finally {
		await unlink(testFile).catch(() => {});
	}
});

test('create_file tool name constant is correct', t => {
	t.is(createFileTool.name, 'create_file');
});
