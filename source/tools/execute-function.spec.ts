import {tmpdir} from 'os';
import {resolve} from 'path';
import test from 'ava';
import {unlink, writeFile} from 'fs/promises';
import {executeBashTool} from './execute-bash.js';
import {readFileTool} from './read-file.js';

// ============================================================================
// Tests for AI SDK v6 Native Tools
// ============================================================================
// These tests validate that the native AI SDK tools work correctly with their
// execute functions. Since tools now only export the native AI SDK tool,
// there's no separate handler to compare against.

// ============================================================================
// Bash Execute Function
// ============================================================================

// execute_bash returns {llmContent, isError}, not a bare string. These tests
// assert on the text the model receives, so they read llmContent. Deliberately
// untyped-cast-free: an `as string` here is what let the return-shape change in
// #1417 land green under tsc and only fail at assert time.
async function runBash(command: string, toolCallId: string): Promise<string> {
	const result = await executeBashTool.tool.execute!(
		{command},
		{toolCallId, messages: []},
	);
	return result.llmContent;
}

test('execute_bash tool works correctly', async t => {
	const result = await runBash('echo "test"', 'test-1');

	t.truthy(result);
	t.regex(result, /test/);
});

test('execute_bash includes exit code', async t => {
	const result = await runBash('echo "success"', 'test-2');

	t.truthy(result);
	t.regex(result, /EXIT_CODE: 0/);
});

test('execute_bash captures stderr', async t => {
	const result = await runBash('echo "error" >&2', 'test-3');

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
		const result = await readFileTool.tool.execute!(
			{path: testFile},
			{
				toolCallId: 'test-4',
				messages: [],
			},
		);

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
		const result = await readFileTool.tool.execute!(
			{path: testFile, start_line: 2, end_line: 4},
			{
				toolCallId: 'test-6',
				messages: [],
			},
		);

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
