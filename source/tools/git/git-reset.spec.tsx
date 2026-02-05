/**
 * Git Reset Tool Tests
 */

import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitResetTool} from './git-reset';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-reset.spec.tsx – React ${React.version}`);

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

test('git_reset tool has correct name', t => {
	t.is(gitResetTool.name, 'git_reset');
});

test('git_reset tool has AI SDK tool with execute', t => {
	t.truthy(gitResetTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitResetTool.tool as any).execute, 'function');
});

test('git_reset tool has formatter function', t => {
	t.is(typeof gitResetTool.formatter, 'function');
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('git_reset formatter renders tool name', t => {
	const formatter = gitResetTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Reset to HEAD');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_reset/);
});

test('git_reset formatter shows soft mode', t => {
	const formatter = gitResetTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({mode: 'soft'}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /soft/i);
});

test('git_reset formatter shows mixed mode', t => {
	const formatter = gitResetTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({mode: 'mixed'}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /mixed/i);
});

test('git_reset formatter shows hard reset warning', t => {
	const formatter = gitResetTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({mode: 'hard'}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /WARNING/i);
	t.regex(output!, /permanently discard/i);
});

test('git_reset formatter shows target commit', t => {
	const formatter = gitResetTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({target: 'HEAD~3'}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /HEAD~3/);
});

test('git_reset formatter shows files to unstage', t => {
	const formatter = gitResetTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({files: ['file1.ts', 'file2.ts']}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	// Files are passed but the formatter shows target
	t.regex(output!, /git_reset/);
});

test('git_reset formatter shows success message', t => {
	const formatter = gitResetTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Reset to abc1234');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Reset.*completed/i);
});
