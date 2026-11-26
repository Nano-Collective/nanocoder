import path from 'node:path';
import type {LLMClient, Message} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {runGit} from '@/utils/git-worktree';
import {type TaskDefinition, TaskSchema, validateDisjointScopes} from './tasks';

const MAX_ATTEMPTS = 3;
const MAX_LISTED_PATHS = 400;

/**
 * The tracked files, so the model can scope tasks to paths that exist. A large
 * repository is summarised as directories with file counts.
 */
export async function describeRepository(cwd: string): Promise<string> {
	const files = (await runGit(['ls-files', '-z'], cwd))
		.split('\0')
		.filter(Boolean);
	if (files.length <= MAX_LISTED_PATHS) return files.join('\n');

	let depth = 4;
	let counts = new Map<string, number>();
	do {
		counts = new Map();
		for (const file of files) {
			const directory = path.posix.dirname(file);
			const key =
				directory === '.'
					? file
					: `${directory.split('/').slice(0, depth).join('/')}/`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		depth--;
	} while (counts.size > MAX_LISTED_PATHS && depth > 0);

	const lines = [...counts].map(([key, count]) =>
		key.endsWith('/') ? `${key} (${count} files)` : key,
	);
	if (lines.length > MAX_LISTED_PATHS) {
		return `${lines.slice(0, MAX_LISTED_PATHS).join('\n')}\n(${lines.length - MAX_LISTED_PATHS} more entries not shown)`;
	}
	return lines.join('\n');
}

function parseTasks(text: string, maxTasks: number): TaskDefinition[] {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end < start) {
		throw new Error('The response did not contain a JSON object.');
	}
	const {tasks} = TaskSchema.parse(JSON.parse(text.slice(start, end + 1)));
	if (tasks.length > maxTasks) {
		throw new Error(`Expected at most ${maxTasks} tasks, got ${tasks.length}.`);
	}
	const overlap = validateDisjointScopes(tasks);
	if (overlap) throw new Error(overlap);
	return tasks;
}

/**
 * Asks the model to split the goal into tasks with disjoint file scopes,
 * telling it what was wrong with a rejected plan before it tries again.
 */
export async function decomposeGoal({
	client,
	goal,
	maxTasks,
	repository,
	signal,
}: {
	client: Pick<LLMClient, 'chat'>;
	goal: string;
	maxTasks: number;
	repository: string;
	signal: AbortSignal;
}): Promise<TaskDefinition[]> {
	const messages: Message[] = [
		{
			role: 'system',
			content: [
				'You plan parallel work for several coding agents that cannot see or talk to each other.',
				'Reply with one JSON object and nothing else:',
				'{"tasks":[{"id":"short-kebab-id","description":"what to do","fileScope":["relative/path"]}]}',
				'Rules:',
				`- Return between 1 and ${maxTasks} tasks. Use fewer when the goal does not split cleanly.`,
				'- Each fileScope lists the files or directories that task may create or edit. Reading is unrestricted.',
				'- No two scopes may overlap, and a directory overlaps everything inside it.',
				'- Use paths relative to the repository root, without globs.',
				'- Each task must be completable without the other tasks having run.',
				'- Each description must be self-contained.',
			].join('\n'),
		},
		{
			role: 'user',
			content: `Goal:\n${goal}\n\nFiles in the repository:\n${repository}`,
		},
	];

	let lastError = '';
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		signal.throwIfAborted();
		const response = await client.chat(messages, {}, {}, signal);
		signal.throwIfAborted();
		const reply = response.choices[0]?.message.content ?? '';
		try {
			return parseTasks(reply, maxTasks);
		} catch (error) {
			lastError = formatError(error);
			messages.push(
				{role: 'assistant', content: reply},
				{
					role: 'user',
					content: `That plan was rejected: ${lastError}\nReply with a corrected JSON object only.`,
				},
			);
		}
	}
	throw new Error(
		`The model did not produce a usable plan in ${MAX_ATTEMPTS} attempts. Last problem: ${lastError}`,
	);
}
