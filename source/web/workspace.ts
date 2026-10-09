import {execFile} from 'node:child_process';
import {readdir, readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import type {Task} from '@/tools/tasks/types';
import type {WebPanel, WebPanelData} from './protocol.js';

const execute = promisify(execFile);
const hiddenDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage']);

async function projectPath(root: string, requested: string): Promise<string> {
	const resolved = await realpath(path.resolve(root, requested));
	const relative = path.relative(root, resolved);
	if (
		relative === '..' ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	)
		throw new Error('Select a file inside the current project.');
	return resolved;
}

export async function getWorkspacePanel(
	panel: WebPanel,
	requested = '',
	options: {root: string; tasks: Task[]},
): Promise<WebPanelData> {
	const root = await realpath(options.root);
	if (panel === 'files') {
		const target = await projectPath(root, requested);
		const info = await stat(target);
		if (info.isDirectory()) {
			const entries = await readdir(target, {withFileTypes: true});
			return {
				panel,
				path: path.relative(root, target),
				items: entries
					.filter(
						entry =>
							!hiddenDirectories.has(entry.name) && !entry.isSymbolicLink(),
					)
					.sort(
						(a, b) =>
							Number(b.isDirectory()) - Number(a.isDirectory()) ||
							a.name.localeCompare(b.name),
					)
					.slice(0, 500)
					.map(entry => ({
						name: entry.name,
						path: path.relative(root, path.join(target, entry.name)),
						kind: entry.isDirectory() ? 'directory' : 'file',
					})),
			};
		}
		if (!info.isFile() || info.size > 256_000)
			throw new Error('Preview supports text files up to 256 KB.');
		const content = await readFile(target, 'utf8');
		if (content.includes('\0'))
			throw new Error('Binary files cannot be previewed.');
		return {panel, path: path.relative(root, target), items: [], content};
	}
	if (panel === 'tasks')
		return {
			panel,
			items: options.tasks.map(task => ({
				name: task.title,
				detail: `${task.status.replace(/_/g, ' ')}${task.description ? ' · ' + task.description : ''}`,
			})),
			message: options.tasks.length
				? undefined
				: 'No tasks in this chat yet. Ask the agent to plan and track a multi-step task.',
		};
	if (panel === 'changes') {
		const git = async (args: string[]) =>
			(
				await execute('git', ['--no-pager', ...args], {
					cwd: root,
					timeout: 10_000,
					maxBuffer: 1024 * 1024,
				})
			).stdout;
		try {
			const status = await git(['status', '--porcelain=v1', '-z']);
			const entries = status.split('\0');
			const items: WebPanelData['items'] = [];
			for (let index = 0; index < entries.length; index++) {
				const entry = entries[index];
				if (!entry) continue;
				const code = entry.slice(0, 2);
				const file = entry.slice(3);
				if (/[RC]/.test(code)) index++;
				items.push({
					name: path.basename(file),
					path: file,
					status: code === '??' ? 'U' : code.trim(),
					detail: path.dirname(file) === '.' ? '' : path.dirname(file),
				});
			}
			if (!requested)
				return {
					panel,
					items,
					message: items.length
						? `${items.length} changed files · Select a file to view its diff`
						: 'Your working tree is clean.',
				};
			const selected = items.find(item => item.path === requested);
			if (!selected) throw new Error('Select a changed file from the list.');
			if (selected.status === 'U') {
				const preview = await getWorkspacePanel('files', requested, options);
				if (preview.content === undefined)
					return {
						panel,
						path: requested,
						items,
						message: 'Untracked directory. Open Files to browse its contents.',
					};
				return {
					panel,
					path: requested,
					items,
					diffs: [
						{
							title: 'Untracked file',
							content: preview.content
								.split('\n')
								.map(line => '+' + line)
								.join('\n'),
						},
					],
					message: 'New file · Not yet tracked by Git',
				};
			}
			const [unstaged, staged] = await Promise.all([
				git([
					'diff',
					'--no-color',
					'--no-ext-diff',
					'--no-textconv',
					'--',
					`:(literal)${requested}`,
				]),
				git([
					'diff',
					'--cached',
					'--no-color',
					'--no-ext-diff',
					'--no-textconv',
					'--',
					`:(literal)${requested}`,
				]),
			]);
			return {
				panel,
				path: requested,
				items,
				diffs: [
					{title: 'Unstaged changes', content: unstaged},
					{title: 'Staged changes', content: staged},
				].filter(diff => diff.content),
				message:
					!unstaged && !staged
						? 'No text diff available for this file.'
						: requested,
			};
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.includes('not a git repository')
			)
				return {
					panel,
					items: [],
					message: 'This project is not a Git repository.',
				};
			throw new Error(
				'Unable to load Git changes. The diff may exceed the 1 MB preview limit.',
			);
		}
	}
	throw new Error('Unsupported workspace panel.');
}
