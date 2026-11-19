/**
 * Git Add Tool Tests
 */

import {execSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitAddTool} from './git-add';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-add.spec.tsx – React ${React.version}`);

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

test('git_add tool has correct name', t => {
	t.is(gitAddTool.name, 'git_add');
});

test('git_add tool has AI SDK tool with execute', t => {
	t.truthy(gitAddTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitAddTool.tool as any).execute, 'function');
});

test('git_add tool has formatter function', t => {
	t.is(typeof gitAddTool.formatter, 'function');
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('git_add formatter renders tool name', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({all: true}, 'Staged 3 file(s)');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_add/);
});

test('git_add formatter shows all mode', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({all: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /all/i);
});

test('git_add formatter shows specific files mode', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({files: ['file1.ts', 'file2.ts']}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /2 specific file/i);
});

test('git_add formatter shows update mode', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({update: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /tracked files only/i);
});

test('git_add formatter shows staging stats', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({all: true}, 'Staged 5 file(s) (+100, -50)');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /5 files/);
	t.regex(output!, /\+100/);
	t.regex(output!, /-50/);
});

test('git_add formatter shows no changes warning', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({all: true}, 'No changes to stage');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /No changes/i);
});

// ============================================================================
// Pathspec Tests
// ============================================================================

type GitAddExecute = (args: {
	files?: string[];
	all?: boolean;
	update?: boolean;
}) => Promise<string>;

/**
 * A repo with one commit and a `.gitignore` for `.env`, so a staged `.env`
 * can only come from git reading it as an option rather than a path.
 */
function createRepo(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	execSync('git init -q -b main', {cwd: dir});
	execSync('git config user.email test@example.com', {cwd: dir});
	execSync('git config user.name Test', {cwd: dir});
	writeFileSync(join(dir, '.gitignore'), '.env\n');
	execSync('git add .gitignore', {cwd: dir});
	execSync('git commit -q -m baseline', {cwd: dir});
	return dir;
}

/** Staged paths only - untracked entries are reported separately by git. */
function stagedPaths(dir: string): string[] {
	const output = execSync('git status --porcelain', {cwd: dir})
		.toString()
		.split('\n')
		.filter(line => line.length > 3 && !line.startsWith('??'));

	return output.map(line => line.slice(3).trim());
}

test.serial('git_add stages a file whose name starts with a dash', async t => {
	t.timeout(30_000);
	const dir = createRepo('nanocoder-git-add-dash-');
	const originalCwd = process.cwd();

	try {
		writeFileSync(join(dir, '-weird.txt'), 'dash\n');
		process.chdir(dir);

		// biome-ignore lint/suspicious/noExplicitAny: Test accesses the AI SDK execute function.
		const execute = (gitAddTool.tool as any).execute as GitAddExecute;
		const result = await execute({files: ['-weird.txt']});

		t.regex(result, /Staged 1 file\(s\)/);
		t.deepEqual(stagedPaths(dir), ['-weird.txt']);
	} finally {
		process.chdir(originalCwd);
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial(
	'git_add rejects an option-shaped entry instead of staging ignored files',
	async t => {
		t.timeout(30_000);
		const dir = createRepo('nanocoder-git-add-option-');
		const originalCwd = process.cwd();

		try {
			writeFileSync(join(dir, '.env'), 'SECRET=1\n');
			process.chdir(dir);

			// biome-ignore lint/suspicious/noExplicitAny: Test accesses the AI SDK execute function.
			const execute = (gitAddTool.tool as any).execute as GitAddExecute;
			const result = await execute({files: ['--force', '.env']});

			t.regex(result, /^Error:/);
			t.deepEqual(stagedPaths(dir), []);
		} finally {
			process.chdir(originalCwd);
			rmSync(dir, {recursive: true, force: true});
		}
	},
);
