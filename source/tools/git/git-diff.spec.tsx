/**
 * Git Diff Tool Tests
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
import {gitDiffTool} from './git-diff';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-diff.spec.tsx – React ${React.version}`);

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

test('git_diff tool has correct name', t => {
	t.is(gitDiffTool.name, 'git_diff');
});

test('git_diff tool has AI SDK tool with execute', t => {
	t.truthy(gitDiffTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitDiffTool.tool as any).execute, 'function');
});

test('git_diff tool has formatter function', t => {
	t.is(typeof gitDiffTool.formatter, 'function');
});

test.serial('git_diff summarizes oversized diffs', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-diff-test-'));
	const originalCwd = process.cwd();

	try {
		execSync('git init -q -b main', {cwd: dir});
		execSync('git config user.email test@example.com', {cwd: dir});
		execSync('git config user.name Test', {cwd: dir});

		const file = join(dir, 'large.txt');
		writeFileSync(file, 'baseline\n');
		execSync('git add large.txt', {cwd: dir});
		execSync('git commit -q -m baseline', {cwd: dir});
		writeFileSync(
			file,
			`${Array.from({length: 600}, (_, index) => `line ${index + 1}`).join('\n')}\n`,
		);

		process.chdir(dir);
		// biome-ignore lint/suspicious/noExplicitAny: Test accesses the AI SDK execute function.
		const execute = (gitDiffTool.tool as any).execute as (
			args: {stat?: boolean},
		) => Promise<string>;
		const result = await execute({});

		t.regex(result, /large\.txt/);
		t.regex(result, /files? changed/);
		t.regex(result, /Diff is too large to return in full/);
		t.regex(result, /file parameter/);
		t.false(result.includes('diff --git'));
	} finally {
		process.chdir(originalCwd);
		rmSync(dir, {recursive: true, force: true});
	}
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('git_diff formatter renders tool name', t => {
	const formatter = gitDiffTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({staged: true}, 'diff --git a/file.ts b/file.ts');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_diff/);
});

test('git_diff formatter shows staged comparison', t => {
	const formatter = gitDiffTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({staged: true}, 'diff output');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /staged/i);
});

test('git_diff formatter shows working tree comparison', t => {
	const formatter = gitDiffTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'diff output');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /working tree/i);
});

test('git_diff formatter shows base branch comparison', t => {
	const formatter = gitDiffTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({base: 'main'}, 'diff output');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /main/);
});

test('git_diff formatter shows no changes message', t => {
	const formatter = gitDiffTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'No staged changes');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /No changes/i);
});

test('git_diff formatter shows file stats', t => {
	const formatter = gitDiffTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{},
		'diff output\n3 files changed, 10 insertions(+), 5 deletions(-)',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /3 files/);
	t.regex(output!, /\+10/);
	t.regex(output!, /-5/);
});
