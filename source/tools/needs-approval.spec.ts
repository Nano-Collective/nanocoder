import test from 'ava';
import {setCurrentMode} from '../context/mode-context.js';
import {executeBashTool} from './execute-bash.js';
import {fetchUrlTool} from './fetch-url.js';
import {copyFileTool} from './file-ops/copy-file.js';
import {deleteFileTool} from './file-ops/delete-file.js';
import {moveFileTool} from './file-ops/move-file.js';
import {stringReplaceTool} from './file-ops/string-replace.js';
import {writeFileTool} from './file-ops/write-file.js';
import {findFilesTool} from './find-files.js';
import {getDiagnosticsTool} from './lsp-get-diagnostics.js';
import {readFileTool} from './read-file.js';
import {searchFileContentsTool} from './search-file-contents.js';
import {webSearchTool} from './web-search.js';

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

// write_file
test('write_file requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(writeFileTool, {
		path: 'test.txt',
		content: 'test',
	});
	t.true(needsApproval);
});

test('write_file does NOT require approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(writeFileTool, {
		path: 'test.txt',
		content: 'test',
	});
	t.false(needsApproval);
});

test('write_file requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(writeFileTool, {
		path: 'test.txt',
		content: 'test',
	});
	t.true(needsApproval);
});

// string_replace
test('string_replace requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(stringReplaceTool, {
		path: 'test.txt',
		old_str: 'old',
		new_str: 'new',
	});
	t.true(needsApproval);
});

test('string_replace does NOT require approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(stringReplaceTool, {
		path: 'test.txt',
		old_str: 'old',
		new_str: 'new',
	});
	t.false(needsApproval);
});

test('string_replace requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(stringReplaceTool, {
		path: 'test.txt',
		old_str: 'old',
		new_str: 'new',
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

// ============================================================================
// SCHEDULER MODE: All tools auto-execute
// ============================================================================

test('execute_bash does NOT require approval in scheduler mode', async t => {
	setCurrentMode('scheduler');
	const needsApproval = await evaluateNeedsApproval(executeBashTool, {
		command: 'ls',
	});
	t.false(needsApproval);
});

test('write_file does NOT require approval in scheduler mode', async t => {
	setCurrentMode('scheduler');
	const needsApproval = await evaluateNeedsApproval(writeFileTool, {
		path: 'test.txt',
		content: 'test',
	});
	t.false(needsApproval);
});

test('string_replace does NOT require approval in scheduler mode', async t => {
	setCurrentMode('scheduler');
	const needsApproval = await evaluateNeedsApproval(stringReplaceTool, {
		path: 'test.txt',
		old_str: 'old',
		new_str: 'new',
	});
	t.false(needsApproval);
});

test('delete_file does NOT require approval in scheduler mode', async t => {
	setCurrentMode('scheduler');
	const needsApproval = await evaluateNeedsApproval(deleteFileTool, {
		path: 'test.txt',
	});
	t.false(needsApproval);
});

test('copy_file does NOT require approval in scheduler mode', async t => {
	setCurrentMode('scheduler');
	const needsApproval = await evaluateNeedsApproval(copyFileTool, {
		source: 'a.txt',
		destination: 'b.txt',
	});
	t.false(needsApproval);
});

test('move_file does NOT require approval in scheduler mode', async t => {
	setCurrentMode('scheduler');
	const needsApproval = await evaluateNeedsApproval(moveFileTool, {
		source: 'a.txt',
		destination: 'b.txt',
	});
	t.false(needsApproval);
});

// ============================================================================
// DELETE FILE: Mode-dependent approval
// ============================================================================

test('delete_file requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = await evaluateNeedsApproval(deleteFileTool, {
		path: 'test.txt',
	});
	t.true(needsApproval);
});

test('delete_file does NOT require approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = await evaluateNeedsApproval(deleteFileTool, {
		path: 'test.txt',
	});
	t.false(needsApproval);
});

test('delete_file requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = await evaluateNeedsApproval(deleteFileTool, {
		path: 'test.txt',
	});
	t.true(needsApproval);
});

// Cleanup: ensure mode is reset after all tests
test.after(() => {
	setCurrentMode('normal');
});
