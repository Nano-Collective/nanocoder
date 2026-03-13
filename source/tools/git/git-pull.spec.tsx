/**
 * Git Pull Tool Tests
 */

import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitPullTool} from './git-pull';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-pull.spec.tsx – React ${React.version}`);

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

test('git_pull tool has correct name', t => {
	t.is(gitPullTool.name, 'git_pull');
});

test('git_pull tool has AI SDK tool with execute', t => {
	t.truthy(gitPullTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitPullTool.tool as any).execute, 'function');
});

test('git_pull tool has formatter function', t => {
	t.is(typeof gitPullTool.formatter, 'function');
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('git_pull formatter renders tool name', t => {
	const formatter = gitPullTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({rebase: true}, 'Pulled from origin/main');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_pull/);
});

test('git_pull formatter renders with rebase option', t => {
	const formatter = gitPullTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({rebase: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_pull/);
});

test('git_pull formatter shows success message', t => {
	const formatter = gitPullTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Pulled from origin/main');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Pull.*completed|success/i);
});

test('git_pull formatter shows already up to date message', t => {
	const formatter = gitPullTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Already up to date');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /up to date/i);
});

test('git_pull formatter shows conflict warning', t => {
	const formatter = gitPullTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'CONFLICT (content): Merge conflict in file.ts');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /conflict/i);
});
