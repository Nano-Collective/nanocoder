/**
 * Git Diff Tool Tests
 */

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
