/**
 * Which files an unattended `full-commit` fix may change before the daemon
 * pushes it straight onto the failing branch. The fix run is steered by a CI
 * log anyone who can open a pull request can influence, and some files turn
 * a pushed change into code execution: in CI (workflows, package scripts,
 * dependency pins), on every developer's machine (git hooks), or in
 * nanocoder itself (project config, plugins, MCP servers). A fix touching
 * any of them is not pushed; it needs a human.
 */

import {devNull} from 'node:os';
import {execGit} from '@/tools/git/utils';

const RESTRICTED_DIRS = new Set([
	'.github',
	'.husky',
	'.githooks',
	'.nanocoder',
]);

const RESTRICTED_FILES = new Set([
	'agents.config.json',
	'.mcp.json',
	'lefthook.yml',
	'lefthook.yaml',
	'.pre-commit-config.yaml',
	// Lockfiles: a changed pin installs different code in CI.
	'package-lock.json',
	'npm-shrinkwrap.json',
	'pnpm-lock.yaml',
	'yarn.lock',
	'bun.lock',
	'bun.lockb',
	'Cargo.lock',
	'Gemfile.lock',
	'poetry.lock',
	'uv.lock',
	'composer.lock',
	'go.sum',
]);

/** package.json fields whose change runs different code on install or test. */
const PACKAGE_EXECUTION_FIELDS = [
	'scripts',
	'bin',
	'dependencies',
	'devDependencies',
	'optionalDependencies',
	'peerDependencies',
	'overrides',
	'resolutions',
	'pnpm',
	'workspaces',
];

/** Why `path` may not be changed by an unattended push, or undefined. */
export function restrictedPathReason(path: string): string | undefined {
	const segments = path.split('/');
	const name = segments.at(-1) ?? path;
	for (const segment of segments.slice(0, -1)) {
		if (RESTRICTED_DIRS.has(segment)) return `${segment}/`;
	}
	// .gitattributes, .gitmodules, .gitignore and the like: git config by
	// another name (filter drivers, submodule URLs).
	if (name.startsWith('.git')) return name;
	if (RESTRICTED_FILES.has(name)) return name;
	return undefined;
}

function executionFields(json: string | undefined): string {
	if (json === undefined) return '';
	try {
		const parsed = JSON.parse(json) as Record<string, unknown>;
		return JSON.stringify(
			PACKAGE_EXECUTION_FIELDS.map(field => parsed[field] ?? null),
		);
	} catch {
		// Not parseable: treat as changed, so the check fails closed.
		return `unparseable:${json}`;
	}
}

// The clone's own config came from the fix run, so read it with plumbing
// that runs no hooks, fsmonitor, textconv or external diff.
const SAFE_GIT = [
	'-c',
	'core.fsmonitor=false',
	'-c',
	`core.hooksPath=${devNull}`,
];

/**
 * The restricted changes between `baseline` and `branch` in the clone, each
 * as "path (reason)". Empty when the fix only touches ordinary files.
 */
export async function findRestrictedChanges(
	clonePath: string,
	baseline: string,
	branch: string,
	exec: typeof execGit = execGit,
): Promise<string[]> {
	const git = (args: string[]) => exec([...SAFE_GIT, '-C', clonePath, ...args]);
	const head = `refs/heads/${branch}`;
	const listed = await git([
		'diff-tree',
		'-r',
		'-z',
		'--no-renames',
		'--name-only',
		baseline,
		head,
	]);
	const paths = listed.split('\0').filter(Boolean);
	const blob = (rev: string, path: string) =>
		git(['cat-file', 'blob', `${rev}:${path}`]).catch(() => undefined);

	const restricted: string[] = [];
	for (const path of paths) {
		const reason = restrictedPathReason(path);
		if (reason) {
			restricted.push(`${path} (${reason})`);
			continue;
		}
		if (path.split('/').at(-1) === 'package.json') {
			const before = executionFields(await blob(baseline, path));
			const after = executionFields(await blob(head, path));
			if (before !== after) {
				restricted.push(`${path} (scripts or dependencies)`);
			}
		}
	}
	return restricted;
}
