import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	resetSessionCwd,
	setProjectRoot,
	setSessionCwd,
} from '@/services/session-cwd';
import {findFilesTool} from './find-files';
import {readFileTool} from './read-file';

console.log('\ntools/session-cwd-resolution.spec.tsx');

// Regression: before the session-cwd fix, file tools resolved relative paths
// against process.cwd() (the launch dir), so after `cd` into a worktree a
// relative read_file looked in the wrong place and failed.

test.serial('read_file resolves a relative path against the session cwd', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'nc-read-'));
	try {
		writeFileSync(join(dir, 'note.txt'), 'hello from the worktree\n');
		setSessionCwd(dir);
		setProjectRoot(dir);
		const result = await readFileTool.tool.execute!(
			{path: 'note.txt'},
			{toolCallId: 't', messages: []},
		);
		t.regex(result, /hello from the worktree/);
	} finally {
		resetSessionCwd();
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('read_file validator accepts a relative path under the session cwd', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'nc-read-'));
	try {
		writeFileSync(join(dir, 'note.txt'), 'x');
		setSessionCwd(dir);
		setProjectRoot(dir);
		const res = await readFileTool.validator!({path: 'note.txt'});
		t.true(res.valid);
	} finally {
		resetSessionCwd();
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('find_files resolves the glob search root against the session cwd', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'nc-find-'));
	try {
		writeFileSync(join(dir, 'widget.ts'), 'export const x = 1;\n');
		setSessionCwd(dir);
		setProjectRoot(dir);
		const result = await findFilesTool.tool.execute!(
			{pattern: '*.ts'},
			{toolCallId: 't', messages: []},
		);
		t.regex(result, /widget\.ts/);
	} finally {
		resetSessionCwd();
		rmSync(dir, {recursive: true, force: true});
	}
});
