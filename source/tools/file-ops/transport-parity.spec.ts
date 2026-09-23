/**
 * Transport parity: bytes on disk must match what the user approved,
 * whether the call originates in the TUI conversation loop or in the
 * ACP server.
 *
 * Both transports converge on `processToolUse` (TUI via
 * `hooks/chat-handler/conversation/tool-executor.tsx`, ACP via
 * `acp/acp-conversation.ts`), so a single test against the real
 * `processToolUse` proves both paths: if either transport had a
 * divergent code path that mutated arguments, this test would catch
 * it.
 */

import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import test from 'ava';

import {diffEditTool} from '@/tools/file-ops/diff-edit';
import {stringReplaceTool} from '@/tools/file-ops/string-replace';
import {writeFileTool} from '@/tools/file-ops/write-file';
import {ToolRegistry} from '@/tools/tool-registry';

import {
	processToolUse,
	setToolRegistryGetter,
} from '@/message-handler';
import {clearPendingHookContext} from '@/services/lifecycle-hooks';
import {setProjectRoot, setSessionCwd} from '@/services/session-cwd';
import {markFileSeen} from '@/utils/read-tracker';

console.log(`\nfile-ops transport parity spec`);

const testDir = mkdtempSync(join(tmpdir(), 'file-ops-parity-'));

test.beforeEach(() => {
	// Reset hook state so previous tests' pre-tool-use / session-start
	// buffers don't leak into this one.
	clearPendingHookContext();
	// Build the registry the same way production does: from the real
	// NanocoderToolExport objects. This wires `write_file.execute` /
	// `string_replace.execute` / `diff_edit.execute` together with their
	// validators, which is what `processToolUse` invokes.
	const registry = ToolRegistry.fromToolExports([
		writeFileTool,
		stringReplaceTool,
		diffEditTool,
	]);
	setToolRegistryGetter(() => registry.getHandlers());
	// Validator requires paths inside the project root. Pin both the root
	// and the session cwd to the test directory so relative paths land
	// where the assertions read them back.
	setProjectRoot(testDir);
	setSessionCwd(testDir);
});

test.after(() => {
	rmSync(testDir, {recursive: true, force: true});
});

function freshPath(name: string): string {
	// Relative path: validator resolves it against the pinned session cwd
	// (testDir). Absolute path would also work but relative makes the
	// "this is a normal user invocation" framing clearer.
	return `${name}-${Date.now()}-${Math.random()}.txt`;
}

function absOf(rel: string): string {
	return join(testDir, rel);
}

function invoke(call: {
	name: 'write_file' | 'string_replace' | 'diff_edit';
	args: Record<string, unknown>;
}) {
	return processToolUse({
		id: 'parity-call',
		function: {name: call.name, arguments: call.args},
	});
}

test.serial(
	'write_file: bytes on disk match between two processToolUse invocations',
	async t => {
		const relPath = freshPath('write');
		const absPath = absOf(relPath);
		const content = 'first line\nsecond line\nthird line\n';

		const resultA = await invoke({
			name: 'write_file',
			args: {path: relPath, content},
		});
		const bytesA = readFileSync(absPath);

		const resultB = await invoke({
			name: 'write_file',
			args: {path: relPath, content},
		});
		const bytesB = readFileSync(absPath);

		t.deepEqual(bytesA, bytesB, 'same input must produce identical bytes');
		t.true(Buffer.isBuffer(bytesA));
		t.is(bytesA.toString('utf-8'), content);
		// processToolUse only sets isError when the result is a structured
		// payload; a plain string result leaves it undefined, which is
		// the success signal here.
		t.not(resultA.isError, true);
		t.not(resultB.isError, true);
	},
);

test.serial(
	'string_replace: bytes on disk match between two processToolUse invocations',
	async t => {
		const relPath = freshPath('string');
		const absPath = absOf(relPath);
		const initial = 'alpha\nbeta\ngamma\n';
		writeFileSync(absPath, initial, 'utf-8');
		// Validator requires a read-before-edit: simulate the model having
		// read the file. Both invocations start from the same read state.
		markFileSeen(absPath);

		const args = {
			path: relPath,
			old_str: 'beta',
			new_str: 'BETA-replaced',
		};

		const resultA = await invoke({name: 'string_replace', args});
		const bytesA = readFileSync(absPath);

		// Reset to the same initial state and run again — proves the result
		// is a function of inputs only, not of any cached state from A.
		writeFileSync(absPath, initial, 'utf-8');
		const resultB = await invoke({name: 'string_replace', args});
		const bytesB = readFileSync(absPath);

		t.deepEqual(bytesA, bytesB, 'same input must produce identical bytes');
		t.is(bytesA.toString('utf-8'), 'alpha\nBETA-replaced\ngamma\n');
		t.not(resultA.isError, true);
		t.not(resultB.isError, true);
	},
);

test.serial(
	'diff_edit: bytes on disk match between two processToolUse invocations',
	async t => {
		const relPath = freshPath('diff');
		const absPath = absOf(relPath);
		const initial = 'line one\nline two\nline three\n';
		writeFileSync(absPath, initial, 'utf-8');
		markFileSeen(absPath);

		const diff =
			'<<<<<<< SEARCH\nline two\n=======\nLINE-TWO\n>>>>>>> REPLACE';
		const args = {path: relPath, diff};

		const resultA = await invoke({name: 'diff_edit', args});
		const bytesA = readFileSync(absPath);

		writeFileSync(absPath, initial, 'utf-8');
		const resultB = await invoke({name: 'diff_edit', args});
		const bytesB = readFileSync(absPath);

		t.deepEqual(bytesA, bytesB, 'same input must produce identical bytes');
		t.is(bytesA.toString('utf-8'), 'line one\nLINE-TWO\nline three\n');
		t.not(resultA.isError, true);
		t.not(resultB.isError, true);
	},
);

// The strongest claim: a $ substitution token written via string_replace
// must round-trip literally even across the parity boundary. Catches the
// class of regression where one transport runs the replacement through
// `String.prototype.replace` and the other uses a literal splitter.
test.serial(
	'string_replace: $ tokens are literal across the parity boundary',
	async t => {
		const relPath = freshPath('literal');
		const absPath = absOf(relPath);
		const initial = 'X\n';
		writeFileSync(absPath, initial, 'utf-8');
		markFileSeen(absPath);

		const args = {
			path: relPath,
			old_str: 'X',
			new_str: "$& $$ $` $'",
		};
		const resultA = await invoke({name: 'string_replace', args});
		const bytesA = readFileSync(absPath);

		writeFileSync(absPath, initial, 'utf-8');
		const resultB = await invoke({name: 'string_replace', args});
		const bytesB = readFileSync(absPath);

		t.deepEqual(bytesA, bytesB);
		t.is(bytesA.toString('utf-8'), '$& $$ $` $\'\n');
		t.not(resultA.isError, true);
		t.not(resultB.isError, true);
	},
);
