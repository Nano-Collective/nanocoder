/**
 * Git Utils Tests
 */

import {execSync} from 'node:child_process';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	createSessionCwdScope,
	runInSessionCwdScope,
} from '@/services/session-cwd';
import {
	parseGitStatus,
	execGit,
	isGitAvailable,
	isGhAvailable,
	resetBinaryAvailabilityCacheForTests,
	getCurrentBranchSync,
	getDefaultBranchSync,
	getGitStatusSummarySync,
	pushBranch,
	truncateDiff,
} from './utils';

// ============================================================================
// Test Helpers
// ============================================================================

console.log('\nutils.spec.ts – Git Utilities');

// ============================================================================
// Availability Check Tests
// ============================================================================

test('isGitAvailable returns boolean', t => {
	const result = isGitAvailable();
	t.is(typeof result, 'boolean');
});

test('isGhAvailable returns boolean', t => {
	const result = isGhAvailable();
	t.is(typeof result, 'boolean');
});

test.serial(
	'PATH scan matches exec verdict for non-executable binaries (Unix only)',
	t => {
		if (process.platform === 'win32') {
			t.pass('executable bits are not meaningful on Windows; skipping');
			return;
		}
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-path-scan-'));
		const originalPath = process.env.PATH;
		const fixture = join(dir, 'git');
		try {
			writeFileSync(fixture, '#!/bin/sh\nexit 0\n');

			// Present but not executable: a shell could not exec it, so the
			// scan must report git unavailable — same verdict execSync gives.
			chmodSync(fixture, 0o644);
			process.env.PATH = dir;
			resetBinaryAvailabilityCacheForTests();
			t.false(isGitAvailable(), 'non-executable git on PATH is not available');

			// Flip the executable bit: now the scan finds it.
			chmodSync(fixture, 0o755);
			resetBinaryAvailabilityCacheForTests();
			t.true(isGitAvailable(), 'executable git on PATH is available');
		} finally {
			process.env.PATH = originalPath;
			resetBinaryAvailabilityCacheForTests();
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial('PATH scan honours quoted PATH entries', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-quoted-path-'));
	const originalPath = process.env.PATH;
	const binaryName = process.platform === 'win32' ? 'git.cmd' : 'git';
	try {
		writeFileSync(
			join(dir, binaryName),
			process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\nexit 0\n',
		);
		chmodSync(join(dir, binaryName), 0o755);

		// cmd.exe accepts quoted PATH entries like "C:\Program Files\Git\cmd";
		// the old `git --version` check resolved them, so the scan must too —
		// otherwise git tools would silently disappear for those installs.
		process.env.PATH = `"${dir}"`;
		resetBinaryAvailabilityCacheForTests();
		t.true(
			isGitAvailable(),
			'quoted PATH entry should still resolve the binary',
		);
	} finally {
		process.env.PATH = originalPath;
		resetBinaryAvailabilityCacheForTests();
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('PATH scan ignores directories named like the binary', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-path-dir-'));
	const originalPath = process.env.PATH;
	const binaryName = process.platform === 'win32' ? 'git.cmd' : 'git';
	try {
		mkdirSync(join(dir, binaryName));

		process.env.PATH = dir;
		resetBinaryAvailabilityCacheForTests();
		t.false(
			isGitAvailable(),
			'a directory on PATH must not count as an installed binary',
		);
	} finally {
		process.env.PATH = originalPath;
		resetBinaryAvailabilityCacheForTests();
		rmSync(dir, {recursive: true, force: true});
	}
});

// ============================================================================
// parseGitStatus Tests
// ============================================================================

test('parseGitStatus parses staged modified files', t => {
	const statusOutput = `M  src/file1.ts
A  src/file2.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 2);
	t.is(result.staged[0]?.status, 'modified');
	t.is(result.staged[0]?.path, 'src/file1.ts');
	t.is(result.staged[1]?.status, 'added');
	t.is(result.staged[1]?.path, 'src/file2.ts');
});

test('parseGitStatus parses staged deleted files', t => {
	const statusOutput = `D  deleted-file.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 1);
	t.is(result.staged[0]?.status, 'deleted');
	t.is(result.staged[0]?.path, 'deleted-file.ts');
});

test('parseGitStatus parses staged renamed files', t => {
	const statusOutput = `R  old-name.ts -> new-name.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 1);
	t.is(result.staged[0]?.status, 'renamed');
});

test('parseGitStatus parses unstaged modified files', t => {
	const statusOutput = ` M src/file1.ts
 D src/file2.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.unstaged.length, 2);
	t.is(result.unstaged[0]?.status, 'modified');
	t.is(result.unstaged[1]?.status, 'deleted');
});

test('parseGitStatus parses untracked files', t => {
	const statusOutput = `?? new-file.ts
?? another-file.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.untracked.length, 2);
	t.true(result.untracked.includes('new-file.ts'));
	t.true(result.untracked.includes('another-file.ts'));
});

test('parseGitStatus handles empty input', t => {
	const result = parseGitStatus('');
	t.is(result.staged.length, 0);
	t.is(result.unstaged.length, 0);
	t.is(result.untracked.length, 0);
	t.is(result.conflicts.length, 0);
});

test('parseGitStatus detects conflicts - UU', t => {
	const statusOutput = `UU conflicted-file.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.conflicts.length, 1);
	t.is(result.conflicts[0], 'conflicted-file.ts');
});

test('parseGitStatus detects conflicts - AA', t => {
	const statusOutput = `AA both-added.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.conflicts.length, 1);
	t.is(result.conflicts[0], 'both-added.ts');
});

test('parseGitStatus detects conflicts - DD', t => {
	const statusOutput = `DD both-deleted.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.conflicts.length, 1);
});

test('parseGitStatus handles mixed status', t => {
	const statusOutput = `M  staged-modified.ts
 M unstaged-modified.ts
?? untracked.ts
UU conflict.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 1);
	t.is(result.unstaged.length, 1);
	t.is(result.untracked.length, 1);
	t.is(result.conflicts.length, 1);
});

test('parseGitStatus handles files with spaces', t => {
	const statusOutput = `M  "file with spaces.ts"`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 1);
});

test('parseGitStatus handles both staged and unstaged changes on same file', t => {
	const statusOutput = `MM both-changes.ts`;

	const result = parseGitStatus(statusOutput);
	// File appears in both staged and unstaged
	t.is(result.staged.length, 1);
	t.is(result.unstaged.length, 1);
});

test('parseGitStatus ignores empty lines', t => {
	const statusOutput = `M  file1.ts

 M file2.ts

`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 1);
	t.is(result.unstaged.length, 1);
});

// ============================================================================
// execGit Tests
// ============================================================================

// A `!` alias runs a shell command with git's environment and stdio, so
// these observe exactly what a hook or credential helper would see.

test('execGit disables terminal prompts', async t => {
	const out = await execGit([
		'-c',
		'alias.envcheck=!printenv GIT_TERMINAL_PROMPT',
		'envcheck',
	]);
	t.is(out, '0');
});

// An ACP session can live in a different repository from the one the agent
// was spawned in (#1707); git has to run in the session's project.
test('execGit runs in the session project inside a session scope', async t => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'nanocoder-git-scope-')));
	try {
		execSync('git init -q', {cwd: dir});
		const topLevel = await runInSessionCwdScope(createSessionCwdScope(dir), () =>
			execGit(['rev-parse', '--show-toplevel']),
		);
		t.is(realpathSync(topLevel.trim()), dir);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('execGit closes stdin so a prompt cannot block', async t => {
	// Hangs forever without the fix: `cat` waits for stdin that never closes.
	const out = await execGit(['-c', 'alias.readstdin=!cat', 'readstdin']);
	t.is(out, '');
});

// ============================================================================
// truncateDiff Tests
// ============================================================================

test('truncateDiff leaves output unchanged below the limit', t => {
	const diff = 'line 1\nline 2\nline 3';
	const result = truncateDiff(diff, 3);

	t.false(result.truncated);
	t.is(result.totalLines, 3);
	t.is(result.content, diff);
});

test('truncateDiff preserves the beginning and end of a large diff', t => {
	const diff = Array.from({length: 10}, (_, index) => `line ${index + 1}`).join(
		'\n',
	);
	const result = truncateDiff(diff, 4);

	t.true(result.truncated);
	t.is(result.totalLines, 10);
	t.true(result.content.startsWith('line 1\nline 2'));
	t.true(result.content.endsWith('line 9\nline 10'));
	t.regex(
		result.content,
		/\[Diff truncated: showing first 2 and last 2 of 10 lines; 6 lines omitted\]/,
	);
	t.false(result.content.includes('line 3'));
});

// ============================================================================
// Synchronous Branch Helper Tests
// ============================================================================
//
// These pass an explicit `startDir` to the helpers instead of relying on
// `process.chdir`. `findGitDirSync` walks up the filesystem, so if `tmpdir()`
// happens to be configured under the working tree (e.g. some CI containers
// with `TMPDIR` overrides) `chdir`-based tests would resolve up to the
// project's own `.git` and produce false negatives.

test('getCurrentBranchSync returns null when not in a git repo', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
	try {
		// Plant a sentinel `.git` directory marker upstream of the temp dir
		// to force the upward walk to terminate inside the temp tree.
		mkdirSync(join(dir, 'sentinel'));
		const result = getCurrentBranchSync(join(dir, 'sentinel'));
		t.is(result, null);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('getCurrentBranchSync reads branch from .git/HEAD on a feature branch', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
	try {
		mkdirSync(join(dir, '.git'));
		writeFileSync(
			join(dir, '.git', 'HEAD'),
			'ref: refs/heads/fix/read-file-empty\n',
		);
		const result = getCurrentBranchSync(dir);
		t.deepEqual(result, {branch: 'fix/read-file-empty', detached: false});
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('getCurrentBranchSync reports detached HEAD when HEAD is a bare SHA', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
	try {
		mkdirSync(join(dir, '.git'));
		writeFileSync(
			join(dir, '.git', 'HEAD'),
			'1234567890abcdef1234567890abcdef12345678\n',
		);
		const result = getCurrentBranchSync(dir);
		t.truthy(result);
		t.true(result?.detached);
		t.is(result?.branch.length, 7);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('getDefaultBranchSync resolves origin/HEAD symbolic ref when present', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
	try {
		mkdirSync(join(dir, '.git', 'refs', 'remotes', 'origin'), {
			recursive: true,
		});
		writeFileSync(
			join(dir, '.git', 'refs', 'remotes', 'origin', 'HEAD'),
			'ref: refs/remotes/origin/main\n',
		);
		const result = getDefaultBranchSync(dir);
		t.is(result, 'main');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('getDefaultBranchSync resolves origin/HEAD from packed-refs', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
	try {
		mkdirSync(join(dir, '.git'));
		writeFileSync(
			join(dir, '.git', 'packed-refs'),
			'# pack-refs with: peeled fully-peeled sorted \n' +
				'# ref: refs/remotes/origin/develop\n' +
				'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef refs/remotes/origin/develop\n',
		);
		const result = getDefaultBranchSync(dir);
		t.is(result, 'develop');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('getDefaultBranchSync falls back to refs/heads/main when no origin HEAD', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
	try {
		mkdirSync(join(dir, '.git', 'refs', 'heads'), {recursive: true});
		writeFileSync(join(dir, '.git', 'refs', 'heads', 'main'), 'deadbeef\n');
		const result = getDefaultBranchSync(dir);
		t.is(result, 'main');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('getGitStatusSummarySync returns null outside of a git repo', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
	try {
		mkdirSync(join(dir, 'sentinel'));
		const result = getGitStatusSummarySync(join(dir, 'sentinel'));
		t.is(result, null);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial(
	'getGitStatusSummarySync reports a real repo on the default branch',
	t => {
		if (!isGitAvailable()) {
			t.pass('git not available; skipping');
			return;
		}
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
		try {
			execSync('git init -q -b main', {cwd: dir});
			execSync(
				'git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init',
				{cwd: dir},
			);
			const result = getGitStatusSummarySync(dir);
			t.truthy(result);
			t.is(result?.branch, 'main');
			t.false(result?.detached);
			t.true(result?.isDefault);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'getGitStatusSummarySync reports a feature branch as non-default',
	t => {
		if (!isGitAvailable()) {
			t.pass('git not available; skipping');
			return;
		}
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
		try {
			execSync('git init -q -b main', {cwd: dir});
			execSync(
				'git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init',
				{cwd: dir},
			);
			execSync('git checkout -q -b feature/x', {cwd: dir});
			const result = getGitStatusSummarySync(dir);
			t.truthy(result);
			t.is(result?.branch, 'feature/x');
			t.false(result?.isDefault);
			t.false(result?.detached);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

// ============================================================================
// pushBranch — real local bare-repo "remote", no network/gh dependency.
// Mirrors postPrComment/getPrNumberForBranch/createDraftPr in never being
// mocked: those need a real `gh` session and have no direct tests either,
// consistent with this file's convention of testing execGit-backed
// functions against a real (offline) repo rather than mocking child_process.
// ============================================================================

test.serial('pushBranch pushes the current branch to a local remote', async t => {
	if (!isGitAvailable()) {
		t.pass('git not available; skipping');
		return;
	}
	const remoteDir = mkdtempSync(join(tmpdir(), 'nanocoder-git-remote-'));
	const cloneDir = mkdtempSync(join(tmpdir(), 'nanocoder-git-clone-'));
	const originalCwd = process.cwd();
	try {
		execSync('git init -q --bare', {cwd: remoteDir});
		execSync(`git clone -q ${JSON.stringify(remoteDir)} ${JSON.stringify(cloneDir)}`);
		execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init', {
			cwd: cloneDir,
		});
		execSync('git checkout -q -b feature/push-test', {cwd: cloneDir});
		execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m fix', {
			cwd: cloneDir,
		});

		process.chdir(cloneDir);
		await pushBranch('feature/push-test', {setUpstream: true});

		const remoteBranches = execSync('git branch', {cwd: remoteDir}).toString();
		t.true(remoteBranches.includes('feature/push-test'));
	} finally {
		process.chdir(originalCwd);
		rmSync(remoteDir, {recursive: true, force: true});
		rmSync(cloneDir, {recursive: true, force: true});
	}
});

test.serial('pushBranch with an explicit cwd pushes from that directory, not process.cwd()', async t => {
	if (!isGitAvailable()) {
		t.pass('git not available; skipping');
		return;
	}
	const remoteDir = mkdtempSync(join(tmpdir(), 'nanocoder-git-remote-'));
	const cloneDir = mkdtempSync(join(tmpdir(), 'nanocoder-git-clone-'));
	try {
		execSync('git init -q --bare', {cwd: remoteDir});
		execSync(`git clone -q ${JSON.stringify(remoteDir)} ${JSON.stringify(cloneDir)}`);
		execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init', {
			cwd: cloneDir,
		});
		execSync('git checkout -q -b feature/push-cwd-test', {cwd: cloneDir});
		execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m fix', {
			cwd: cloneDir,
		});

		// Deliberately do NOT chdir the test process — the whole point of
		// `cwd` is to work without it, since the daemon's own process.cwd()
		// is a different, unrelated directory (this is the mechanism that
		// lets ci-fix-orchestrator.ts publish a fix committed inside an
		// isolated clone).
		await pushBranch('feature/push-cwd-test', {setUpstream: true, cwd: cloneDir});

		const remoteBranches = execSync('git branch', {cwd: remoteDir}).toString();
		t.true(remoteBranches.includes('feature/push-cwd-test'));
	} finally {
		rmSync(remoteDir, {recursive: true, force: true});
		rmSync(cloneDir, {recursive: true, force: true});
	}
});
