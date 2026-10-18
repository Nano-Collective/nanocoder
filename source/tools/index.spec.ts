/**
 * Tool registry startup behaviour (#1819)
 *
 * Building the built-in tool exports used to evaluate `getGitTools()` at
 * import time, which spawned `git --version`, `git rev-parse` and
 * `gh --version` with `execSync` — blocking the first rendered frame by
 * ~200ms. These tests pin both halves of the fix: no child processes while
 * the registry is built, and the same conditional registration behaviour
 * (git tools inside a repo, hidden outside; `git_pr` gated on gh).
 */

import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import test from 'ava';
import {getAllToolExports} from '@/tools/index';
import {isGhAvailable, isGitAvailable, isInsideGitRepo} from '@/tools/git/utils';

console.log('\nindex.spec.ts – Tool Registry Startup');

test.serial(
	'building the tool registry spawns no child processes (#1819)',
	t => {
		const original = {
			execSync: cp.execSync,
			exec: cp.exec,
			spawnSync: cp.spawnSync,
			spawn: cp.spawn,
			fork: cp.fork,
		};
		const spawned: string[] = [];
		const blocked = (label: string) =>
			function blockedSpawn(): never {
				spawned.push(label);
				throw new Error(`${label} must not be called while building the tool registry`);
			};

		cp.execSync = blocked('execSync') as typeof cp.execSync;
		cp.exec = blocked('exec') as typeof cp.exec;
		cp.spawnSync = blocked('spawnSync') as typeof cp.spawnSync;
		cp.spawn = blocked('spawn') as typeof cp.spawn;
		cp.fork = blocked('fork') as typeof cp.fork;
		syncBuiltinESMExports();

		try {
			const exports = getAllToolExports();
			t.true(exports.length > 0, 'registry should not be empty');
			t.deepEqual(spawned, [], 'no child process may be spawned at registry build time');
		} finally {
			Object.assign(cp, original);
			syncBuiltinESMExports();
		}
	},
);

test('git tools are registered conditionally as before', t => {
	const names = new Set(getAllToolExports().map(entry => entry.name));

	if (isGitAvailable() && isInsideGitRepo()) {
		for (const gitTool of [
			'git_status',
			'git_diff',
			'git_log',
			'git_add',
			'git_commit',
		]) {
			t.true(names.has(gitTool), `${gitTool} should be registered inside a repo`);
		}
		// The PR tool is gated on the gh CLI, same as before the lazy check.
		t.is(names.has('git_pr'), isGhAvailable(), 'git_pr should track gh availability');
	} else {
		t.false(names.has('git_status'), 'git tools should be hidden without git or outside a repo');
		t.false(names.has('git_pr'), 'git_pr should be hidden without git or outside a repo');
	}
});
