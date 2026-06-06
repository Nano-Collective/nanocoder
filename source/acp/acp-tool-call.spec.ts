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
