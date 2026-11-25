import test from 'ava';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	createSessionContext,
	runInSessionContext,
} from '@/services/session-context';
import {TUNE_DEFAULTS, type TuneConfig} from '@/types/config';
import {
	formatGitSnapshot,
	type GitSnapshot,
	getGitContextSection,
	parseBranchHeader,
	readGitSnapshot,
} from './git-context';
import {buildSystemPrompt} from './prompt-builder';

console.log('\ngit-context.spec.ts');

const gitEnv = {
	...process.env,
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_TERMINAL_PROMPT: '0',
	GIT_AUTHOR_NAME: 'Git test',
	GIT_AUTHOR_EMAIL: 'git-test@example.com',
	GIT_COMMITTER_NAME: 'Git test',
	GIT_COMMITTER_EMAIL: 'git-test@example.com',
};

function git(repo: string, ...args: string[]): string {
	return execFileSync('git', ['-C', repo, ...args], {
		env: gitEnv,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	});
}

function makeRepo(t: {teardown: (fn: () => void) => void}): string {
	const repo = mkdtempSync(join(tmpdir(), 'nanocoder-git-context-'));
	t.teardown(() => rmSync(repo, {recursive: true, force: true}));
	git(repo, 'init', '--initial-branch=main');
	return repo;
}

function commit(repo: string, file: string, message: string): void {
	writeFileSync(join(repo, file), message);
	git(repo, 'add', '--', file);
	git(repo, 'commit', '-m', message);
}

const BASE: GitSnapshot = {
	branch: 'main',
	detached: false,
	defaultBranch: 'main',
	upstream: null,
	upstreamGone: false,
	ahead: 0,
	behind: 0,
	status: null,
	commits: [],
};

// ============================================================================
// parseBranchHeader
// ============================================================================

test('parseBranchHeader - reads upstream and ahead/behind counts', t => {
	t.deepEqual(parseBranchHeader('## main...origin/main [ahead 2, behind 3]'), {
		upstream: 'origin/main',
		upstreamGone: false,
		ahead: 2,
		behind: 3,
	});
});

test('parseBranchHeader - a branch without upstream has none', t => {
	t.deepEqual(parseBranchHeader('## topic'), {
		upstream: null,
		upstreamGone: false,
		ahead: 0,
		behind: 0,
	});
	t.is(parseBranchHeader('## No commits yet on main').upstream, null);
	t.is(parseBranchHeader('## HEAD (no branch)').upstream, null);
});

test('parseBranchHeader - reports an upstream that is gone', t => {
	const parsed = parseBranchHeader('## topic...origin/topic [gone]');
	t.is(parsed.upstream, 'origin/topic');
	t.true(parsed.upstreamGone);
});

// ============================================================================
// formatGitSnapshot
// ============================================================================

test('formatGitSnapshot - labels the block as a session-start snapshot', t => {
	const text = formatGitSnapshot({
		...BASE,
		status: {
			staged: 0,
			modified: 0,
			untracked: 0,
			conflicted: 0,
			paths: [],
			totalPaths: 0,
		},
	});
	t.true(text.startsWith('## REPOSITORY SNAPSHOT'));
	t.true(text.includes('Taken at session start'));
	t.true(text.includes('Branch: main (default branch)'));
	t.true(text.includes('Upstream: none'));
	t.true(text.includes('Working tree: clean'));
});

test('formatGitSnapshot - shows counts, capped paths and commits', t => {
	const text = formatGitSnapshot({
		...BASE,
		branch: 'feature',
		upstream: 'origin/feature',
		ahead: 1,
		behind: 4,
		status: {
			staged: 1,
			modified: 2,
			untracked: 0,
			conflicted: 1,
			paths: ['M  a.ts', ' M b.ts'],
			totalPaths: 14,
		},
		commits: ['abc1234 Fix the thing'],
	});
	t.true(text.includes('Branch: feature (default branch: main)'));
	t.true(text.includes('Upstream: origin/feature (1 ahead, 4 behind)'));
	t.true(text.includes('Working tree: 1 staged, 2 modified, 1 conflicted'));
	t.true(text.includes('  M  a.ts'));
	t.true(text.includes('  ... and 12 more'));
	t.true(text.includes('Recent commits:\n  abc1234 Fix the thing'));
});

test('formatGitSnapshot - describes a detached HEAD', t => {
	const text = formatGitSnapshot({...BASE, branch: 'abc1234', detached: true});
	t.true(text.includes('Branch: detached HEAD at abc1234'));
	t.false(text.includes('Upstream:'));
});

// ============================================================================
// readGitSnapshot (real repositories)
// ============================================================================

test('readGitSnapshot - returns null outside a git repository', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-context-none-'));
	t.teardown(() => rmSync(dir, {recursive: true, force: true}));
	// tmpdir() may itself sit inside a repository; only assert when it does not.
	try {
		execFileSync('git', ['-C', dir, 'rev-parse', '--git-dir'], {
			stdio: 'ignore',
		});
		t.pass('tmpdir is inside a git repository; skipped');
	} catch {
		t.is(readGitSnapshot(dir), null);
	}
});

test('readGitSnapshot - handles a repository without commits', t => {
	const repo = makeRepo(t);
	writeFileSync(join(repo, 'new.txt'), 'x');
	const snapshot = readGitSnapshot(repo);
	t.truthy(snapshot);
	t.is(snapshot?.branch, 'main');
	t.deepEqual(snapshot?.commits, []);
	t.is(snapshot?.status?.untracked, 1);
});

test('readGitSnapshot - reads branch, status and recent commits', t => {
	const repo = makeRepo(t);
	for (let i = 1; i <= 7; i++) commit(repo, `f${i}.txt`, `commit ${i}`);
	writeFileSync(join(repo, 'f1.txt'), 'changed');
	writeFileSync(join(repo, 'f2.txt'), 'staged');
	git(repo, 'add', '--', 'f2.txt');
	writeFileSync(join(repo, 'untracked.txt'), 'u');

	const snapshot = readGitSnapshot(repo);
	t.truthy(snapshot);
	t.is(snapshot?.branch, 'main');
	t.false(snapshot?.detached);
	t.deepEqual(snapshot?.status && {...snapshot.status, paths: []}, {
		staged: 1,
		modified: 1,
		untracked: 1,
		conflicted: 0,
		paths: [],
		totalPaths: 3,
	});
	t.is(snapshot?.commits.length, 5);
	t.regex(snapshot?.commits[0] ?? '', /^[0-9a-f]{7,} commit 7$/);
});

test('readGitSnapshot - reports a detached HEAD', t => {
	const repo = makeRepo(t);
	commit(repo, 'a.txt', 'one');
	commit(repo, 'b.txt', 'two');
	git(repo, 'checkout', '--detach', 'HEAD~1');
	const snapshot = readGitSnapshot(repo);
	t.true(snapshot?.detached);
	t.true(formatGitSnapshot(snapshot as GitSnapshot).includes('detached HEAD'));
});

// ============================================================================
// getGitContextSection / buildSystemPrompt
// ============================================================================

test('getGitContextSection - is taken once per session', t => {
	const repo = makeRepo(t);
	commit(repo, 'a.txt', 'first commit');
	runInSessionContext(createSessionContext(repo), () => {
		const first = getGitContextSection();
		t.true(first.includes('first commit'));
		commit(repo, 'b.txt', 'second commit');
		t.is(getGitContextSection(), first);
	});
	runInSessionContext(createSessionContext(repo), () => {
		t.true(getGitContextSection().includes('second commit'));
	});
});

test('buildSystemPrompt - includes the git snapshot in a repository', t => {
	const repo = makeRepo(t);
	commit(repo, 'a.txt', 'snapshot subject');
	const prompt = runInSessionContext(createSessionContext(repo), () =>
		buildSystemPrompt('normal', TUNE_DEFAULTS, ['read_file']),
	);
	t.true(prompt.includes('## REPOSITORY SNAPSHOT'));
	t.true(prompt.includes('snapshot subject'));
});

test('buildSystemPrompt - omits the git snapshot under the nano profile', t => {
	const repo = makeRepo(t);
	commit(repo, 'a.txt', 'snapshot subject');
	const nano: TuneConfig = {
		enabled: true,
		toolProfile: 'nano',
		aggressiveCompact: true,
	};
	const prompt = runInSessionContext(createSessionContext(repo), () =>
		buildSystemPrompt('normal', nano, ['read_file']),
	);
	t.false(prompt.includes('REPOSITORY SNAPSHOT'));
});

test('buildSystemPrompt - omits the git snapshot when nanocoder.gitContext is false', t => {
	const repo = makeRepo(t);
	commit(repo, 'a.txt', 'snapshot subject');
	writeFileSync(
		join(repo, 'agents.config.json'),
		JSON.stringify({nanocoder: {gitContext: false}}),
	);
	const prompt = runInSessionContext(createSessionContext(repo), () =>
		buildSystemPrompt('normal', TUNE_DEFAULTS, ['read_file']),
	);
	t.false(prompt.includes('REPOSITORY SNAPSHOT'));
});
