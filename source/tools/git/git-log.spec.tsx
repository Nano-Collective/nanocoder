/**
 * Git Log Tool Tests
 */

import {execFileSync} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitLogTool} from './git-log';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-log.spec.tsx – React ${React.version}`);

function TestThemeProvider({children}: {children: React.ReactNode}) {
	const themeContextValue = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{children}
		</ThemeContext.Provider>
	);
}

// ============================================================================
// Tool Definition Tests
// ============================================================================

test('git_log tool has correct name', t => {
	t.is(gitLogTool.name, 'git_log');
});

test('git_log tool has AI SDK tool with execute', t => {
	t.truthy(gitLogTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitLogTool.tool as any).execute, 'function');
});

test('git_log tool has formatter function', t => {
	t.is(typeof gitLogTool.formatter, 'function');
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('git_log formatter renders tool name', t => {
	const formatter = gitLogTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({count: 5}, 'Showing 5 commit(s) on main:');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_log/);
});

test('git_log formatter shows branch name', t => {
	const formatter = gitLogTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Showing 10 commit(s) on feature/test:');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /feature\/test/);
});

test('git_log formatter shows commit count', t => {
	const formatter = gitLogTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({count: 10}, 'Showing 10 commit(s) on main:');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /10 commits/);
});

test('git_log formatter shows author filter', t => {
	const formatter = gitLogTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{author: 'john'},
		'Showing 5 commit(s) on main:',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /author.*john/i);
});

test('git_log formatter shows grep filter', t => {
	const formatter = gitLogTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({grep: 'fix'}, 'Showing 3 commit(s) on main:');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /grep.*fix/i);
});

test('git_log formatter shows file filter', t => {
	const formatter = gitLogTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{file: 'src/index.ts'},
		'Showing 5 commit(s) on main:',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /file.*src\/index\.ts/i);
});

// ============================================================================
// Execution Tests
// ============================================================================

type GitLogArgs = {branch?: string; count?: number; file?: string};

// biome-ignore lint/suspicious/noExplicitAny: Test accesses the AI SDK execute function.
const executeGitLog = (gitLogTool.tool as any).execute as (
	args: GitLogArgs,
) => Promise<string>;

function git(cwd: string, ...args: string[]): void {
	execFileSync('git', args, {cwd, stdio: 'pipe'});
}

function commit(cwd: string, file: string, message: string): void {
	writeFileSync(join(cwd, file), `${message}\n`);
	git(cwd, 'add', file);
	git(
		cwd,
		'-c',
		'user.email=test@example.com',
		'-c',
		'user.name=Test',
		'-c',
		'commit.gpgsign=false',
		'commit',
		'-q',
		'-m',
		message,
	);
}

/**
 * Runs git_log inside a repo where `feature` has a commit `main` does not,
 * with `main` checked out.
 */
async function runInRepoWithFeatureBranch(
	args: GitLogArgs,
): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-log-test-'));
	const originalCwd = process.cwd();
	try {
		git(dir, 'init', '-q', '-b', 'main');
		commit(dir, 'base.txt', 'base commit');
		git(dir, 'checkout', '-q', '-b', 'feature');
		commit(dir, 'feature.txt', 'feature only commit');
		git(dir, 'checkout', '-q', 'main');
		commit(dir, 'main.txt', 'main only commit');

		process.chdir(dir);
		return await executeGitLog(args);
	} finally {
		process.chdir(originalCwd);
		rmSync(dir, {recursive: true, force: true});
	}
}

test.serial(
	'git_log returns the commits of the requested branch, not HEAD',
	async t => {
		const result = await runInRepoWithFeatureBranch({branch: 'feature'});

		t.regex(result, /^Showing 2 commit\(s\) on feature:/);
		t.regex(result, /feature only commit/);
		t.regex(result, /base commit/);
		t.false(result.includes('main only commit'));
	},
);

test.serial(
	'git_log without a branch still returns the checked-out branch',
	async t => {
		const result = await runInRepoWithFeatureBranch({});

		t.regex(result, /^Showing 2 commit\(s\) on main:/);
		t.regex(result, /main only commit/);
		t.false(result.includes('feature only commit'));
	},
);

test.serial(
	'git_log reports the branch when it has no matching commits',
	async t => {
		const result = await runInRepoWithFeatureBranch({
			branch: 'does-not-exist',
		});

		t.is(result, 'No commits found matching filters: branch: does-not-exist');
	},
);

/**
 * Runs git_log inside a repo with both a `docs` branch and a `docs/` folder,
 * with `main` checked out. Without `--` after the revision, git refuses the
 * bare `docs` as ambiguous ("both revision and filename").
 */
async function runInRepoWithBranchNamedLikeAFolder(
	args: GitLogArgs,
): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-log-test-'));
	const originalCwd = process.cwd();
	try {
		git(dir, 'init', '-q', '-b', 'main');
		mkdirSync(join(dir, 'docs'));
		commit(dir, 'docs/guide.md', 'add the guide');
		git(dir, 'checkout', '-q', '-b', 'docs');
		commit(dir, 'docs/guide.md', 'docs branch rewrites the guide');
		git(dir, 'checkout', '-q', 'main');
		commit(dir, 'main.txt', 'main only commit');

		process.chdir(dir);
		return await executeGitLog(args);
	} finally {
		process.chdir(originalCwd);
		rmSync(dir, {recursive: true, force: true});
	}
}

test.serial(
	'git_log reads a branch named like an existing folder as the branch',
	async t => {
		const result = await runInRepoWithBranchNamedLikeAFolder({branch: 'docs'});

		t.regex(result, /^Showing 2 commit\(s\) on docs:/);
		t.regex(result, /docs branch rewrites the guide/);
		t.false(result.includes('main only commit'));
	},
);

test.serial(
	'git_log narrows a branch named like a folder to a file in it',
	async t => {
		const result = await runInRepoWithBranchNamedLikeAFolder({
			branch: 'docs',
			file: 'docs/guide.md',
		});

		t.regex(result, /^Showing 2 commit\(s\) on docs:/);
		t.regex(result, /docs branch rewrites the guide/);
		t.regex(result, /add the guide/);
	},
);

test.serial(
	'git_log rejects a branch that git would parse as an option',
	async t => {
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-log-test-'));
		const outputFile = join(dir, 'written-by-git.txt');
		const originalCwd = process.cwd();
		try {
			git(dir, 'init', '-q', '-b', 'main');
			commit(dir, 'base.txt', 'base commit');
			process.chdir(dir);

			const result = await executeGitLog({branch: `--output=${outputFile}`});

			t.is(result, `Error: Invalid branch name: --output=${outputFile}`);
			t.false(existsSync(outputFile));
		} finally {
			process.chdir(originalCwd);
			rmSync(dir, {recursive: true, force: true});
		}
	},
);
