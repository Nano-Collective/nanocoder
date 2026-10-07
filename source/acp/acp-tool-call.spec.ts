import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'ava';
import {buildToolCallMeta} from '@/acp/acp-tool-call';
import type {ToolCall} from '@/types/core';

console.log('\nacp-tool-call.spec.ts');

const makeCall = (
	name: string,
	args: Record<string, unknown>,
): ToolCall => ({
	id: 'call-1',
	function: {name, arguments: args},
});

test('buildToolCallMeta - maps read_file to kind read with location', async t => {
	const meta = await buildToolCallMeta(
		makeCall('read_file', {path: '/tmp/foo.ts'}),
	);
	t.is(meta.kind, 'read');
	t.is(meta.locations[0]?.path, resolve('/tmp/foo.ts'));
	t.is(meta.content.length, 0);
	t.true(meta.title.includes('/tmp/foo.ts'));
});

test('buildToolCallMeta - maps execute_bash to kind execute with no location', async t => {
	const meta = await buildToolCallMeta(
		makeCall('execute_bash', {command: 'ls'}),
	);
	t.is(meta.kind, 'execute');
	t.is(meta.locations.length, 0);
	t.is(meta.title, 'execute_bash: ls');
});

// diff_edit is the nano profile's editing tool, so on a small local model it is
// the only writer the client ever sees. Without the mapping it renders as a
// generic tool row instead of an edit.
test('buildToolCallMeta - maps diff_edit to kind edit with location', async t => {
	const meta = await buildToolCallMeta(
		makeCall('diff_edit', {path: '/tmp/foo.ts', diff: '<<<<<<< SEARCH'}),
	);
	t.is(meta.kind, 'edit');
	t.is(meta.locations[0]?.path, resolve('/tmp/foo.ts'));
	t.is(meta.title, 'diff_edit: /tmp/foo.ts');
});

// file_op is four operations behind one name; the kind is what tells a client
// whether the path is appearing, moving or going away.
test('buildToolCallMeta - file_op delete reports the removed file', async t => {
	const meta = await buildToolCallMeta(
		makeCall('file_op', {operation: 'delete', path: '/tmp/foo.ts'}),
	);
	t.is(meta.kind, 'delete');
	t.deepEqual(
		meta.locations.map(location => location.path),
		[resolve('/tmp/foo.ts')],
	);
	t.is(meta.title, 'file_op: delete /tmp/foo.ts');
});

test('buildToolCallMeta - file_op move reports source then destination', async t => {
	const meta = await buildToolCallMeta(
		makeCall('file_op', {
			operation: 'move',
			path: '/tmp/foo.ts',
			destination: '/tmp/bar.ts',
		}),
	);
	t.is(meta.kind, 'move');
	// Source first, destination last - a client drops the one and follows the
	// file to the other.
	t.deepEqual(
		meta.locations.map(location => location.path),
		[resolve('/tmp/foo.ts'), resolve('/tmp/bar.ts')],
	);
});

test('buildToolCallMeta - file_op copy reports only the new file', async t => {
	const meta = await buildToolCallMeta(
		makeCall('file_op', {
			operation: 'copy',
			path: '/tmp/foo.ts',
			destination: '/tmp/bar.ts',
		}),
	);
	// A copy creates a file and leaves its source alone, so it reads as an edit
	// of the destination.
	t.is(meta.kind, 'edit');
	t.deepEqual(
		meta.locations.map(location => location.path),
		[resolve('/tmp/bar.ts')],
	);
});

test('buildToolCallMeta - file_op mkdir is not an edit', async t => {
	const meta = await buildToolCallMeta(
		makeCall('file_op', {operation: 'mkdir', path: '/tmp/nested'}),
	);
	// It creates a directory, which is nothing for a client to open.
	t.is(meta.kind, 'other');
	// And so it reports no location either: clients follow `locations` to open
	// what a call touched, and a directory would send them nowhere useful.
	t.deepEqual(meta.locations, []);
});

test('buildToolCallMeta - unknown tool falls back to other', async t => {
	const meta = await buildToolCallMeta(makeCall('some_mcp_tool', {}));
	t.is(meta.kind, 'other');
	t.is(meta.content.length, 0);
});

test('buildToolCallMeta - ask_user uses the question as the title', async t => {
	const meta = await buildToolCallMeta(
		makeCall('ask_user', {
			question: 'Which database?',
			options: ['Postgres', 'SQLite'],
		}),
	);
	t.is(meta.title, 'Which database?');
	t.is(meta.content.length, 0);
});

test('buildToolCallMeta - agent shows subagent and task with prompt body', async t => {
	const meta = await buildToolCallMeta(
		makeCall('agent', {
			subagent_type: 'Explore',
			description: 'find the auth code',
			prompt: 'Search the repo for authentication logic.',
		}),
	);
	t.is(meta.kind, 'think');
	t.is(meta.title, 'Explore: find the auth code');
	const body = meta.content[0] as any;
	t.is(body.type, 'content');
	t.is(body.content.text, 'Search the repo for authentication logic.');
});

test('buildToolCallMeta - execute_bash includes the command in the title', async t => {
	const meta = await buildToolCallMeta(
		makeCall('execute_bash', {command: 'pnpm run build'}),
	);
	t.is(meta.kind, 'execute');
	t.true(meta.title.includes('pnpm run build'));
});

test('buildToolCallMeta - string_replace produces whole-file diff for unique match', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'acp-tc-'));
	const file = join(dir, 'a.ts');
	writeFileSync(file, 'const a = 1;\nconst b = 2;\n');
	try {
		const meta = await buildToolCallMeta(
			makeCall('string_replace', {
				path: file,
				old_str: 'const b = 2;',
				new_str: 'const b = 3;',
			}),
		);
		t.is(meta.kind, 'edit');
		const diff = meta.content[0] as any;
		t.is(diff.type, 'diff');
		t.is(diff.path, resolve(file));
		t.is(diff.oldText, 'const a = 1;\nconst b = 2;\n');
		t.is(diff.newText, 'const a = 1;\nconst b = 3;\n');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('buildToolCallMeta - string_replace falls back to hunk diff when file missing', async t => {
	const meta = await buildToolCallMeta(
		makeCall('string_replace', {
			path: '/no/such/file.ts',
			old_str: 'foo',
			new_str: 'bar',
		}),
	);
	const diff = meta.content[0] as any;
	t.is(diff.type, 'diff');
	t.is(diff.oldText, 'foo');
	t.is(diff.newText, 'bar');
});

test('buildToolCallMeta - write_file diff has null oldText for new file', async t => {
	const meta = await buildToolCallMeta(
		makeCall('write_file', {path: '/no/such/new-file.ts', content: 'hi'}),
	);
	t.is(meta.kind, 'edit');
	const diff = meta.content[0] as any;
	t.is(diff.type, 'diff');
	t.is(diff.oldText, null);
	t.is(diff.newText, 'hi');
});

test('buildToolCallMeta - write_file diff captures existing content as oldText', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'acp-tc-'));
	const file = join(dir, 'b.ts');
	writeFileSync(file, 'old body');
	try {
		const meta = await buildToolCallMeta(
			makeCall('write_file', {path: file, content: 'new body'}),
		);
		const diff = meta.content[0] as any;
		t.is(diff.oldText, 'old body');
		t.is(diff.newText, 'new body');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

// ============================================================================
// withDiff: false - the queued-batch announcement discards content, so it must
// not pay to read the file off disk first.
// ============================================================================

test('buildToolCallMeta - withDiff false skips the string_replace diff', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'acp-nodiff-'));
	try {
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'const a = 1;\n');

		const call = makeCall('string_replace', {
			path: file,
			old_str: 'const a = 1;',
			new_str: 'const a = 2;',
		});

		const announced = await buildToolCallMeta(call, {withDiff: false});
		t.is(announced.content.length, 0, 'no diff is built');

		// Everything the checklist row needs still comes back.
		t.is(announced.kind, 'edit');
		t.is(announced.locations[0]?.path, resolve(file));
		t.true(announced.title.includes('a.ts'));

		// And the default still diffs.
		const full = await buildToolCallMeta(call);
		t.is(full.content.length, 1);
		t.is(full.title, announced.title);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('buildToolCallMeta - withDiff false skips the write_file diff', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'acp-nodiff-'));
	try {
		const file = join(dir, 'b.ts');
		writeFileSync(file, 'old body\n');

		const call = makeCall('write_file', {path: file, content: 'new body'});

		const announced = await buildToolCallMeta(call, {withDiff: false});
		t.is(announced.content.length, 0, 'no diff is built');
		t.is(announced.kind, 'edit');
		t.is(announced.locations[0]?.path, resolve(file));

		const full = await buildToolCallMeta(call);
		t.is(full.content.length, 1);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('buildToolCallMeta - withDiff false does not read the file', async t => {
	// A path that cannot be read would make the diff builders fall back rather
	// than throw, so assert on the observable outcome: nothing is attached and
	// the metadata is still complete.
	const meta = await buildToolCallMeta(
		makeCall('string_replace', {
			path: '/definitely/missing/nowhere.ts',
			old_str: 'a',
			new_str: 'b',
		}),
		{withDiff: false},
	);
	t.is(meta.content.length, 0);
	t.is(meta.kind, 'edit');
});

test('buildToolCallMeta - withDiff true is the default', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'acp-nodiff-'));
	try {
		const file = join(dir, 'c.ts');
		writeFileSync(file, 'x\n');
		const call = makeCall('write_file', {path: file, content: 'y'});

		t.is((await buildToolCallMeta(call)).content.length, 1);
		t.is((await buildToolCallMeta(call, {})).content.length, 1);
		t.is((await buildToolCallMeta(call, {withDiff: true})).content.length, 1);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('buildToolCallMeta - string_replace diff shows $ tokens literally', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'acp-tc-'));
	const file = join(dir, 'run.sh');
	writeFileSync(file, '#!/bin/sh\necho "old"\nexit 0\n');
	const replacement = 'echo "pid=$$ match=$& pre=$` post=$\'"';
	try {
		const meta = await buildToolCallMeta(
			makeCall('string_replace', {
				path: file,
				old_str: 'echo "old"',
				new_str: replacement,
			}),
		);
		// The previewed diff has to be the diff that lands on disk.
		const diff = meta.content[0] as any;
		t.is(diff.newText, `#!/bin/sh\n${replacement}\nexit 0\n`);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});
