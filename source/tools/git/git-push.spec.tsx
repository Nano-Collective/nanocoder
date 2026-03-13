/**
 * Git Push Tool Tests
 */

import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitPushTool} from './git-push';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-push.spec.tsx – React ${React.version}`);

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

test('git_push tool has correct name', t => {
	t.is(gitPushTool.name, 'git_push');
});

test('git_push tool has AI SDK tool with execute', t => {
	t.truthy(gitPushTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitPushTool.tool as any).execute, 'function');
});

test('git_push tool has formatter function', t => {
	t.is(typeof gitPushTool.formatter, 'function');
});

test('git_push tool has validator function', t => {
	t.is(typeof gitPushTool.validator, 'function');
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('git_push formatter renders tool name', t => {
	const formatter = gitPushTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Pushed to origin/main');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_push/);
});

test('git_push formatter shows force push warning', t => {
	const formatter = gitPushTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({force: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /FORCE PUSH/i);
});

test('git_push formatter shows force-with-lease warning', t => {
	const formatter = gitPushTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({forceWithLease: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /FORCE.*LEASE/i);
});

test('git_push formatter shows setUpstream indicator', t => {
	const formatter = gitPushTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({setUpstream: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /upstream/i);
});

test('git_push formatter shows success message', t => {
	const formatter = gitPushTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Pushed to origin/main\n2 commits pushed');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Push.*success|Pushed/i);
});

test('git_push formatter renders without errors', t => {
	const formatter = gitPushTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_push/);
});
