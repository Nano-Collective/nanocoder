import test from 'ava';
import {setCurrentMode} from '../context/mode-context.js';
import {executeBashTool} from './execute-bash.js';
import {createFileTool} from './create-file.js';
import {insertLinesTool} from './insert-lines.js';
import {replaceLinesTool} from './replace-lines.js';
import {deleteLinesTool} from './delete-lines.js';
import {readFileTool} from './read-file.js';
import {findFilesTool} from './find-files.js';
import {searchFileContentsTool} from './search-file-contents.js';
import {webSearchTool} from './web-search.js';
import {fetchUrlTool} from './fetch-url.js';
import {getDiagnosticsTool} from './lsp-get-diagnostics.js';

// ============================================================================
// Tests for needsApproval Logic (AI SDK v6)
// ============================================================================
// These tests validate the core security feature: mode-based approval.
// They ensure tools require approval at the correct times based on risk level.

// Helper function to evaluate needsApproval (static or async)
async function evaluateNeedsApproval(tool: any, args: any): Promise<boolean> {
	const needsApproval = tool.tool.needsApproval;

	if (typeof needsApproval === 'boolean') {
		return needsApproval;
	}

	if (typeof needsApproval === 'function') {
		return await needsApproval(args);
	}

	return false;
}

// ============================================================================
// HIGH RISK: Bash Tool (always requires approval)
// ============================================================================

test('execute_bash always requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(executeBashTool, {
		command: 'ls',
	});
	t.true(needsApproval);
});

test('execute_bash always requires approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(executeBashTool, {
		command: 'ls',
	});
	t.true(needsApproval);
});

test('execute_bash always requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(executeBashTool, {
		command: 'ls',
	});
	t.true(needsApproval);
});

// ============================================================================
// MEDIUM RISK: File Write Tools (mode-dependent approval)
// ============================================================================

// create_file
test('create_file requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(createFileTool, {
		path: 'test.txt',
		content: 'test',
	});
	t.true(needsApproval);
});

test('create_file does NOT require approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(createFileTool, {
		path: 'test.txt',
		content: 'test',
	});
	t.false(needsApproval);
});

test('create_file requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(createFileTool, {
		path: 'test.txt',
		content: 'test',
	});
	t.true(needsApproval);
});

// insert_lines
test('insert_lines requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(insertLinesTool, {
		path: 'test.txt',
		line_number: 1,
		content: 'test',
	});
	t.true(needsApproval);
});

test('insert_lines does NOT require approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(insertLinesTool, {
		path: 'test.txt',
		line_number: 1,
		content: 'test',
	});
	t.false(needsApproval);
});

test('insert_lines requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(insertLinesTool, {
		path: 'test.txt',
		line_number: 1,
		content: 'test',
	});
	t.true(needsApproval);
});

// replace_lines
test('replace_lines requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(replaceLinesTool, {
		path: 'test.txt',
		start_line: 1,
		end_line: 2,
		new_content: 'test',
	});
	t.true(needsApproval);
});

test('replace_lines does NOT require approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(replaceLinesTool, {
		path: 'test.txt',
		start_line: 1,
		end_line: 2,
		new_content: 'test',
	});
	t.false(needsApproval);
});

test('replace_lines requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(replaceLinesTool, {
		path: 'test.txt',
		start_line: 1,
		end_line: 2,
		new_content: 'test',
	});
	t.true(needsApproval);
});

// delete_lines
test('delete_lines requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(deleteLinesTool, {
		path: 'test.txt',
		start_line: 1,
		end_line: 2,
	});
	t.true(needsApproval);
});

test('delete_lines does NOT require approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(deleteLinesTool, {
		path: 'test.txt',
		start_line: 1,
		end_line: 2,
	});
	t.false(needsApproval);
});

test('delete_lines requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(deleteLinesTool, {
		path: 'test.txt',
		start_line: 1,
		end_line: 2,
	});
	t.true(needsApproval);
});

// ============================================================================
// LOW RISK: Read-Only Tools (never require approval)
// ============================================================================

// read_file
test('read_file never requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(readFileTool, {
		path: 'test.txt',
	});
	t.false(needsApproval);
});

test('read_file never requires approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(readFileTool, {
		path: 'test.txt',
	});
	t.false(needsApproval);
});

test('read_file never requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(readFileTool, {
		path: 'test.txt',
	});
	t.false(needsApproval);
});

// find_files
test('find_files never requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(findFilesTool, {
		pattern: '*.ts',
	});
	t.false(needsApproval);
});

test('find_files never requires approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(findFilesTool, {
		pattern: '*.ts',
	});
	t.false(needsApproval);
});

test('find_files never requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(findFilesTool, {
		pattern: '*.ts',
	});
	t.false(needsApproval);
});

// search_file_contents
test('search_file_contents never requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(searchFileContentsTool, {
		pattern: 'test',
	});
	t.false(needsApproval);
});

test('search_file_contents never requires approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(searchFileContentsTool, {
		pattern: 'test',
	});
	t.false(needsApproval);
});

test('search_file_contents never requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(searchFileContentsTool, {
		pattern: 'test',
	});
	t.false(needsApproval);
});

// web_search
test('web_search never requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(webSearchTool, {
		query: 'test',
	});
	t.false(needsApproval);
});

test('web_search never requires approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(webSearchTool, {
		query: 'test',
	});
	t.false(needsApproval);
});

test('web_search never requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(webSearchTool, {
		query: 'test',
	});
	t.false(needsApproval);
});

// fetch_url
test('fetch_url never requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(fetchUrlTool, {
		url: 'https://example.com',
	});
	t.false(needsApproval);
});

test('fetch_url never requires approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(fetchUrlTool, {
		url: 'https://example.com',
	});
	t.false(needsApproval);
});

test('fetch_url never requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(fetchUrlTool, {
		url: 'https://example.com',
	});
	t.false(needsApproval);
});

// lsp_get_diagnostics
test('lsp_get_diagnostics never requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(getDiagnosticsTool, {
		path: 'test.txt',
	});
	t.false(needsApproval);
});

test('lsp_get_diagnostics never requires approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(getDiagnosticsTool, {
		path: 'test.txt',
	});
	t.false(needsApproval);
});

test('lsp_get_diagnostics never requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(getDiagnosticsTool, {
		path: 'test.txt',
	});
	t.false(needsApproval);
});

// Cleanup: ensure mode is reset after all tests
test.after(() => {
	setCurrentMode('normal');
});
