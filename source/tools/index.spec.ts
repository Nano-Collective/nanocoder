/**
 * Tool registry startup behaviour (#1819)
 *
 * Building the built-in tool exports used to evaluate `getGitTools()` at
 * import time, which spawned `git --version`, `git rev-parse` and
 * `gh --version` with `execSync` — blocking the first rendered frame by
 * ~200ms. These tests pin both halves of the fix: no child processes while
 * the registry is built (including its module-init path), and the same
 * conditional registration behaviour (git tools inside a repo, hidden
 * outside; `git_pr` gated on gh) re-evaluated per call rather than frozen
 * by the PATH-lookup memoization.
 */

import cp from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {resetBinaryAvailabilityCacheForTests} from '@/tools/git/utils';

console.log('\nindex.spec.ts – Tool Registry Startup');

test.serial(
	'building the tool registry spawns no child processes (#1819)',
	async t => {
		const original = {
			execSync: cp.execSync,
			exec: cp.exec,
			spawnSync: cp.spawnSync,
			spawn: cp.spawn,
			fork: cp.fork,
		};
		const spawned: string[] = [];
		const blocked =
			(label: string) =>
			(): never => {
				spawned.push(label);
				throw new Error(
					`${label} must not be called while building the tool registry`,
				);
			};

		cp.execSync = blocked('execSync') as typeof cp.execSync;
		cp.exec = blocked('exec') as typeof cp.exec;
		cp.spawnSync = blocked('spawnSync') as typeof cp.spawnSync;
		cp.spawn = blocked('spawn') as typeof cp.spawn;
		cp.fork = blocked('fork') as typeof cp.fork;
		syncBuiltinESMExports();

		try {
			// Import inside the patched window: this is the worker's first load
			// of the module, so a regression that reintroduces a spawn into the
			// module-init path is caught here, not just one in getAllToolExports.
			const {getAllToolExports} = await import('@/tools/index');
			const exports = getAllToolExports();
			t.true(exports.length > 0, 'registry should not be empty');
			t.deepEqual(
				spawned,
				[],
				'no child process may be spawned at registry build time',
			);
		} finally {
			Object.assign(cp, original);
			syncBuiltinESMExports();
		}
	},
);

test.serial(
	'git tools follow PATH availability, re-evaluated per call',
	async t => {
		const {getAllToolExports} = await import('@/tools/index');
		const {isGhAvailable, isGitAvailable, isInsideGitRepo} = await import(
			'@/tools/git/utils'
		);

		const emptyDir = mkdtempSync(join(tmpdir(), 'nanocoder-empty-path-'));
		const originalPath = process.env.PATH;
		try {
			// Scenario 1: git and gh not on PATH → no git tools registered.
			process.env.PATH = emptyDir;
			resetBinaryAvailabilityCacheForTests();
			const withoutGit = new Set(getAllToolExports().map(entry => entry.name));
			t.false(withoutGit.has('git_status'), 'git_status hidden without git');
			t.false(withoutGit.has('git_commit'), 'git_commit hidden without git');
			t.false(withoutGit.has('git_pr'), 'git_pr hidden without gh');

			// Scenario 2: real PATH restored → git tools are back. This proves
			// the memoized "not found" verdict from scenario 1 does not stick.
			process.env.PATH = originalPath;
			resetBinaryAvailabilityCacheForTests();
			const names = new Set(getAllToolExports().map(entry => entry.name));
			if (isGitAvailable() && isInsideGitRepo()) {
				for (const gitTool of [
					'git_status',
					'git_diff',
					'git_log',
					'git_add',
					'git_commit',
				]) {
					t.true(names.has(gitTool), `${gitTool} registered inside a repo`);
				}
				// The PR tool is gated on the gh CLI, same as before the lazy check.
				t.is(
					names.has('git_pr'),
					isGhAvailable(),
					'git_pr should track gh availability',
				);
			} else {
				t.false(
					names.has('git_status'),
					'git tools hidden when git is missing or outside a repo',
				);
			}
		} finally {
			process.env.PATH = originalPath;
			resetBinaryAvailabilityCacheForTests();
			rmSync(emptyDir, {recursive: true, force: true});
		}
	},
);
