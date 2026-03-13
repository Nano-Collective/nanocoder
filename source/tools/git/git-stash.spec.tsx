/**
 * Git Stash Tool Tests
 */

import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitStashTool} from './git-stash';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-stash.spec.tsx – React ${React.version}`);

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

test('git_stash tool has correct name', t => {
	t.is(gitStashTool.name, 'git_stash');
});

test('git_stash tool has AI SDK tool with execute', t => {
	t.truthy(gitStashTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitStashTool.tool as any).execute, 'function');
});

test('git_stash tool has formatter function', t => {
	t.is(typeof gitStashTool.formatter, 'function');
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('git_stash formatter renders tool name', t => {
	const formatter = gitStashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({list: true}, 'stash@{0}: WIP on main');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_stash/);
});

test('git_stash formatter shows push action', t => {
	const formatter = gitStashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({push: {message: 'Work in progress'}}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /push/i);
});

test('git_stash formatter shows list action', t => {
	const formatter = gitStashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({list: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /list/i);
});

test('git_stash formatter shows pop action', t => {
	const formatter = gitStashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({pop: {}}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /pop/i);
});

test('git_stash formatter shows apply action', t => {
	const formatter = gitStashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({apply: {index: 0}}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /apply/i);
});

test('git_stash formatter shows drop action', t => {
	const formatter = gitStashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({drop: {index: 0}}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /drop/i);
});

test('git_stash formatter shows clear warning', t => {
	const formatter = gitStashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({clear: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /permanently delete/i);
});

test('git_stash formatter shows stash success', t => {
	const formatter = gitStashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{push: {}},
		'Changes stashed successfully: stash@{0}',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /stashed/i);
});

test('git_stash formatter shows apply success', t => {
	const formatter = gitStashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({apply: {}}, 'Applied stash@{0}');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /applied/i);
});

test('git_stash formatter shows conflict warning', t => {
	const formatter = gitStashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({pop: {}}, 'CONFLICT (content): Merge conflict');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /conflict/i);
});
