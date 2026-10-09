import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'ava';
import {getWorkspacePanel} from './workspace.js';

test('file browsing previews text and prevents traversal and external symlinks', async t => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'nano-web-files-'));
	t.teardown(() => rm(root, {recursive: true, force: true}));
	await mkdir(path.join(root, 'src'));
	await mkdir(path.join(root, 'node_modules'));
	await writeFile(path.join(root, 'src', 'hello.ts'), 'export const hello = true;');
	await writeFile(path.join(root, 'binary'), Buffer.from([0, 1]));
	await symlink(os.tmpdir(), path.join(root, 'external'));
	const options = {root, tasks: []};
	const listing = await getWorkspacePanel('files', '', options);
	t.true(listing.items.some(item => item.name === 'src' && item.kind === 'directory'));
	t.false(listing.items.some(item => item.name === 'node_modules' || item.name === 'external'));
	t.is((await getWorkspacePanel('files', 'src/hello.ts', options)).content, 'export const hello = true;');
	await t.throwsAsync(getWorkspacePanel('files', '..', options), {message: 'Select a file inside the current project.'});
	await t.throwsAsync(getWorkspacePanel('files', 'external', options), {message: 'Select a file inside the current project.'});
	await t.throwsAsync(getWorkspacePanel('files', 'binary', options), {message: 'Binary files cannot be previewed.'});
});

test('Changes returns staged, unstaged and untracked files without changing them', async t => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'nano-web-git-'));
	t.teardown(() => rm(root, {recursive: true, force: true}));
	const git = (args: string[]) => promisify(execFile)('git', args, {cwd: root});
	await git(['init']);
	await writeFile(path.join(root, 'file.txt'), 'staged\n');
	await git(['add', 'file.txt']);
	await writeFile(path.join(root, 'file.txt'), 'unstaged\n');
	await writeFile(path.join(root, 'untracked.txt'), 'new');
	const data = await getWorkspacePanel('changes', '', {root, tasks: []});
	t.true(data.items.some(item => item.name === 'file.txt'));
	t.true(data.items.some(item => item.name === 'untracked.txt'));
	t.is(data.content, undefined);
	const selected = await getWorkspacePanel('changes', 'file.txt', {root, tasks: []});
	t.true(selected.diffs!.some(diff => diff.title === 'Staged changes' && diff.content.includes('+staged')));
	t.true(selected.diffs!.some(diff => diff.title === 'Unstaged changes' && diff.content.includes('+unstaged')));
	const untracked = await getWorkspacePanel('changes', 'untracked.txt', {root, tasks: []});
	t.is(untracked.diffs![0].content, '+new');
	await t.throwsAsync(getWorkspacePanel('changes', '../outside', {root, tasks: []}));
});

test('Tasks uses the supplied current-session list and handles empty projects', async t => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'nano-web-tasks-'));
	t.teardown(() => rm(root, {recursive: true, force: true}));
	const task = {id: 'task', title: 'Fix login', status: 'in_progress' as const, createdAt: '', updatedAt: ''};
	t.like(await getWorkspacePanel('tasks', '', {root, tasks: [task]}), {items: [{name: 'Fix login', detail: 'in progress'}]});
	t.truthy((await getWorkspacePanel('tasks', '', {root, tasks: []})).message);
	t.is((await getWorkspacePanel('changes', '', {root, tasks: []})).message, 'This project is not a Git repository.');
});
