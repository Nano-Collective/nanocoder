/**
 * Git Log Tool Tests
 */

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
