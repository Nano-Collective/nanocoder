import test from 'ava';
import type {DevelopmentMode, NanocoderToolExport} from '../types/core.js';
import {resolveToolApproval} from './approval-policy.js';
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
// Tests for tool approval policy (mode-aware, single resolver)
// ============================================================================
// These tests validate the core security feature: mode-based approval.
// Approval is resolved by resolveToolApproval() with the mode passed in
// explicitly (no global state). They ensure tools require approval at the
// correct times based on risk level.

// Helper: resolve approval for a tool export in a given mode.
function evaluateNeedsApproval(
	tool: NanocoderToolExport,
	mode: DevelopmentMode,
	// biome-ignore lint/suspicious/noExplicitAny: test args are arbitrary
	args: any,
): Promise<boolean> {
	return resolveToolApproval(tool.name, tool, args, {mode});
}

// ============================================================================
// HIGH RISK: Bash Tool (always requires approval except headless/yolo)
// ============================================================================

test('execute_bash always requires approval in normal mode', async t => {
	t.true(await evaluateNeedsApproval(executeBashTool, 'normal', {command: 'ls'}));
});

test('execute_bash always requires approval in auto-accept mode', async t => {
	t.true(
		await evaluateNeedsApproval(executeBashTool, 'auto-accept', {command: 'ls'}),
	);
});

test('execute_bash always requires approval in plan mode', async t => {
	t.true(await evaluateNeedsApproval(executeBashTool, 'plan', {command: 'ls'}));
});

// ============================================================================
// MEDIUM RISK: File Write Tools (mode-dependent approval)
// ============================================================================

test('write_file requires approval in normal mode', async t => {
	t.true(
		await evaluateNeedsApproval(writeFileTool, 'normal', {
			path: 'test.txt',
			content: 'test',
		}),
	);
});

test('write_file does NOT require approval in auto-accept mode', async t => {
	t.false(
		await evaluateNeedsApproval(writeFileTool, 'auto-accept', {
			path: 'test.txt',
			content: 'test',
		}),
	);
});

test('write_file requires approval in plan mode', async t => {
	t.true(
		await evaluateNeedsApproval(writeFileTool, 'plan', {
			path: 'test.txt',
			content: 'test',
		}),
	);
});

test('string_replace requires approval in normal mode', async t => {
	t.true(
		await evaluateNeedsApproval(stringReplaceTool, 'normal', {
			path: 'test.txt',
			old_str: 'old',
			new_str: 'new',
		}),
	);
});

test('string_replace does NOT require approval in auto-accept mode', async t => {
	t.false(
		await evaluateNeedsApproval(stringReplaceTool, 'auto-accept', {
			path: 'test.txt',
			old_str: 'old',
			new_str: 'new',
		}),
	);
});

test('string_replace requires approval in plan mode', async t => {
	t.true(
		await evaluateNeedsApproval(stringReplaceTool, 'plan', {
			path: 'test.txt',
			old_str: 'old',
			new_str: 'new',
		}),
	);
});

// ============================================================================
// LOW RISK: Read-Only Tools (never require approval, via !readOnly default)
// ============================================================================

for (const mode of ['normal', 'auto-accept', 'plan'] as const) {
	test(`read_file never requires approval in ${mode} mode`, async t => {
		t.false(await evaluateNeedsApproval(readFileTool, mode, {path: 'test.txt'}));
	});

	test(`find_files never requires approval in ${mode} mode`, async t => {
		t.false(await evaluateNeedsApproval(findFilesTool, mode, {pattern: '*.ts'}));
	});

	test(`search_file_contents never requires approval in ${mode} mode`, async t => {
		t.false(
			await evaluateNeedsApproval(searchFileContentsTool, mode, {
				pattern: 'test',
			}),
		);
	});

	test(`web_search never requires approval in ${mode} mode`, async t => {
		t.false(await evaluateNeedsApproval(webSearchTool, mode, {query: 'test'}));
	});

	test(`fetch_url never requires approval in ${mode} mode`, async t => {
		t.false(
			await evaluateNeedsApproval(fetchUrlTool, mode, {
				url: 'https://example.com',
			}),
		);
	});

	test(`lsp_get_diagnostics never requires approval in ${mode} mode`, async t => {
		t.false(
			await evaluateNeedsApproval(getDiagnosticsTool, mode, {path: 'test.txt'}),
		);
	});
}

// ============================================================================
// HEADLESS MODE: All tools auto-execute. Headless is the daemon-only mode
// used for triggered skill runs (file.changed, schedule.cron); it has the
// same approval posture as the legacy `scheduler` mode it superseded.
// ============================================================================

test('execute_bash does NOT require approval in headless mode', async t => {
	t.false(
		await evaluateNeedsApproval(executeBashTool, 'headless', {command: 'ls'}),
	);
});

test('write_file does NOT require approval in headless mode', async t => {
	t.false(
		await evaluateNeedsApproval(writeFileTool, 'headless', {
			path: 'test.txt',
			content: 'test',
		}),
	);
});

test('string_replace does NOT require approval in headless mode', async t => {
	t.false(
		await evaluateNeedsApproval(stringReplaceTool, 'headless', {
			path: 'test.txt',
			old_str: 'old',
			new_str: 'new',
		}),
	);
});

test('delete_file does NOT require approval in headless mode', async t => {
	t.false(
		await evaluateNeedsApproval(deleteFileTool, 'headless', {path: 'test.txt'}),
	);
});

test('copy_file does NOT require approval in headless mode', async t => {
	t.false(
		await evaluateNeedsApproval(copyFileTool, 'headless', {
			source: 'a.txt',
			destination: 'b.txt',
		}),
	);
});

test('move_file does NOT require approval in headless mode', async t => {
	t.false(
		await evaluateNeedsApproval(moveFileTool, 'headless', {
			source: 'a.txt',
			destination: 'b.txt',
		}),
	);
});

// ============================================================================
// DELETE FILE: Mode-dependent approval
// ============================================================================

test('delete_file requires approval in normal mode', async t => {
	t.true(
		await evaluateNeedsApproval(deleteFileTool, 'normal', {path: 'test.txt'}),
	);
});

test('delete_file does NOT require approval in auto-accept mode', async t => {
	t.false(
		await evaluateNeedsApproval(deleteFileTool, 'auto-accept', {
			path: 'test.txt',
		}),
	);
});

test('delete_file requires approval in plan mode', async t => {
	t.true(await evaluateNeedsApproval(deleteFileTool, 'plan', {path: 'test.txt'}));
});

// ============================================================================
// alwaysAllow pre-authorization short-circuits to no approval
// ============================================================================

test('alwaysAllow list pre-authorizes a tool regardless of mode', async t => {
	t.false(
		await resolveToolApproval(
			executeBashTool.name,
			executeBashTool,
			{command: 'ls'},
			{mode: 'normal', alwaysAllow: ['execute_bash']},
		),
	);
});

// ============================================================================
// Yolo mode bypasses approval for every tool, without exception
// ============================================================================

test('yolo mode bypasses approval even for always-approve tools', async t => {
	// A tool that always requires approval in every other mode (e.g. git_commit).
	t.false(
		await resolveToolApproval('git_commit', {approval: true}, {}, {mode: 'yolo'}),
	);
});

test('yolo mode bypasses approval for high-risk dynamic tools', async t => {
	t.false(
		await evaluateNeedsApproval(executeBashTool, 'yolo', {command: 'rm -rf /'}),
	);
});

// ============================================================================
// Fail-safe: unknown tool requires approval
// ============================================================================

test('unknown tool (no entry) requires approval', async t => {
	t.true(await resolveToolApproval('mystery_tool', undefined, {}, {mode: 'normal'}));
});
