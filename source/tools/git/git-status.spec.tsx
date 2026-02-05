/**
 * Git Status Tool Tests
 */

import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitStatusTool} from './git-status';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-status.spec.tsx – React ${React.version}`);

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

test('git_status tool has correct name', t => {
	t.is(gitStatusTool.name, 'git_status');
});

test('git_status tool has AI SDK tool with execute', t => {
	t.truthy(gitStatusTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitStatusTool.tool as any).execute, 'function');
});

test('git_status tool has formatter function', t => {
	t.is(typeof gitStatusTool.formatter, 'function');
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('git_status formatter renders tool name', t => {
	const formatter = gitStatusTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{},
		'Branch: main\nUpstream: origin/main\nWorking tree clean',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_status/);
});

test('git_status formatter shows branch name', t => {
	const formatter = gitStatusTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Branch: feature/test\nWorking tree clean');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /feature\/test/);
});

test('git_status formatter shows ahead/behind count', t => {
	const formatter = gitStatusTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Branch: main\nSync: 2 ahead, 1 behind');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /2 ahead/);
	t.regex(output!, /1 behind/);
});

test('git_status formatter renders branch', t => {
	const formatter = gitStatusTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Branch: main\nStatus: Clean');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /main/);
});

test('git_status formatter shows clean status', t => {
	const formatter = gitStatusTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Branch: main\nStatus: Clean');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Clean/i);
});
