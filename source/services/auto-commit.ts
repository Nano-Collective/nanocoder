import {existsSync} from 'node:fs';
import {dirname, isAbsolute, relative, resolve} from 'node:path';

import {getAppConfig} from '@/config/index';
import {resolveFilePath} from '@/services/lifecycle-hooks';
import {getSafeSessionCwd} from '@/services/session-cwd';
import {COMMIT_SYSTEM_PROMPT} from '@/tools/git/commit-prompt';
import {execGit, truncateDiff} from '@/tools/git/utils';
import type {LLMClient, Message} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {logInfo, logWarning} from '@/utils/message-queue';

/** Tools whose successful run leaves a file edit worth committing. */
const AUTO_COMMIT_TOOLS: ReadonlySet<string> = new Set([
	'write_file',
	'string_replace',
	'diff_edit',
]);

/** Lines of diff handed to the model. One file's edit rarely needs more. */
const MAX_DIFF_LINES = 300;

/** Budget for the commit-message round trip before the fallback is used. */
const MESSAGE_TIMEOUT_MS = 30_000;

/**
 * Repository states where committing would land in the middle of the user's
 * own operation (resolving a merge, stepping through a rebase), so the edit is
 * left uncommitted instead.
 */
const IN_PROGRESS_MARKERS = [
	'MERGE_HEAD',
	'CHERRY_PICK_HEAD',
	'REVERT_HEAD',
	'rebase-merge',
	'rebase-apply',
];

let activeClient: LLMClient | null = null;

/**
 * Point auto-commit at the client used for commit messages. Kept in sync with
 * the session's client, so a /model or /provider switch is picked up.
 */
export function setAutoCommitClient(client: LLMClient | null): void {
	activeClient = client;
}

/**
 * Every auto-commit runs through this chain. Parallel tool calls finish at
 * the same moment, and two `git add` / `git commit` runs racing each other
 * fail on `.git/index.lock`.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
	const run = queue.then(task, task);
	queue = run.catch(() => {});
	return run;
}

/**
 * Commit the file a successful edit tool just changed, when
 * `nanocoder.autoCommit` is on.
 *
 * Only that file is committed (`git commit -- <path>` has `--only`
 * semantics), so the user's own uncommitted or staged work is never swept into
 * an agent commit. Never throws: a failure is logged and the edit stays in the
 * working tree, exactly as if auto-commit were off.
 *
 * Returns a one-line note for the tool result, so the model knows a commit
 * happened, or null when nothing was committed.
 */
export async function maybeAutoCommit(
	toolName: string,
	toolArgs: Record<string, unknown>,
): Promise<string | null> {
	if (!getAppConfig().autoCommit || !AUTO_COMMIT_TOOLS.has(toolName)) {
		return null;
	}
	const filePath = resolveFilePath(toolArgs);
	if (!filePath) return null;

	// Resolved the same way the file tools resolve it.
	const absPath = resolve(getSafeSessionCwd(), filePath);

	try {
		return await enqueue(() => commitFile(absPath));
	} catch (error) {
		logWarning(`Auto-commit skipped: ${formatError(error)}`);
		return null;
	}
}

async function commitFile(absPath: string): Promise<string | null> {
	// Asking git from the file's own directory finds the repository the file
	// is actually in, which is not always the one the session started in.
	let root: string;
	try {
		root = await execGit([
			'-C',
			dirname(absPath),
			'rev-parse',
			'--show-toplevel',
		]);
	} catch {
		return null; // Not a git repository: nothing to commit into.
	}

	const git = (...args: string[]) => execGit(['-C', root, ...args]);
	// Forward slashes: git pathspecs use them on every platform.
	const pathspec = relative(root, absPath).split('\\').join('/');
	// Outside the repository: a `../` escape, or on Windows another drive,
	// where relative() gives back an absolute path.
	if (
		!pathspec ||
		pathspec === '..' ||
		pathspec.startsWith('../') ||
		isAbsolute(pathspec)
	) {
		return null;
	}

	if (await isOperationInProgress(git, root)) {
		logWarning(
			`Auto-commit skipped for ${pathspec}: a merge, rebase, cherry-pick or revert is in progress.`,
		);
		return null;
	}

	if (await isIgnored(git, pathspec)) return null;

	await git('add', '--', pathspec);
	const diff = await git(
		'diff',
		'--cached',
		'--no-ext-diff',
		'--no-color',
		'--',
		pathspec,
	);
	// The edit left the file as it already was in HEAD.
	if (!diff.trim()) return null;

	const message = await generateMessage(diff, pathspec);
	const output = await git('commit', '-m', message, '--', pathspec);

	const hash = output.match(/\[[^\]]*?([a-f0-9]{7,})\]/)?.[1] ?? '';
	const subject = message.split('\n')[0];
	logInfo(`Auto-committed ${pathspec}${hash ? ` (${hash})` : ''}: ${subject}`);
	return `[auto-commit] ${hash ? `${hash} ` : ''}${subject}`;
}

async function isOperationInProgress(
	git: (...args: string[]) => Promise<string>,
	root: string,
): Promise<boolean> {
	for (const marker of IN_PROGRESS_MARKERS) {
		try {
			// --git-path answers relative to the -C directory, and follows the
			// indirection a worktree's `.git` file adds.
			const markerPath = await git('rev-parse', '--git-path', marker);
			if (existsSync(resolve(root, markerPath))) return true;
		} catch {
			// Unable to ask: fall through to the next marker.
		}
	}
	return false;
}

async function isIgnored(
	git: (...args: string[]) => Promise<string>,
	pathspec: string,
): Promise<boolean> {
	try {
		// Exits 0 when ignored, 1 (a rejection here) when not.
		await git('check-ignore', '-q', '--', pathspec);
		return true;
	} catch {
		return false;
	}
}

/**
 * Ask the session's model for a Conventional Commit message, falling back to
 * a plain one so a missing, slow or unhelpful model never loses the commit.
 */
async function generateMessage(
	diff: string,
	pathspec: string,
): Promise<string> {
	const fallback = `chore: update ${pathspec}`;
	const client = activeClient;
	if (!client) return fallback;

	const messages: Message[] = [
		{role: 'system', content: COMMIT_SYSTEM_PROMPT},
		{role: 'user', content: truncateDiff(diff, MAX_DIFF_LINES).content},
	];

	try {
		const response = await client.chat(
			messages,
			{},
			{},
			AbortSignal.timeout(MESSAGE_TIMEOUT_MS),
		);
		return cleanMessage(response?.choices?.[0]?.message?.content) || fallback;
	} catch (error) {
		logWarning(
			`Auto-commit message generation failed (${formatError(error)}); using "${fallback}".`,
		);
		return fallback;
	}
}

/** Strip the code fence a model sometimes wraps the message in despite the prompt. */
export function cleanMessage(raw: string | undefined): string {
	if (!raw) return '';
	return raw
		.trim()
		.replace(/^```[\w-]*\s*\n?/, '')
		.replace(/\n?```$/, '')
		.trim();
}
