/**
 * Git Branch Tool Tests
 */

import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitBranchTool} from './git-branch';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-branch.spec.tsx – React ${React.version}`);

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

test('git_branch tool has correct name', t => {
	t.is(gitBranchTool.name, 'git_branch');
});

test('git_branch tool has AI SDK tool with execute', t => {
	t.truthy(gitBranchTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitBranchTool.tool as any).execute, 'function');
});

test('git_branch tool has formatter function', t => {
	t.is(typeof gitBranchTool.formatter, 'function');
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('git_branch formatter renders tool name', t => {
	const formatter = gitBranchTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Branches:');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_branch/);
});

test('git_branch formatter shows list action', t => {
	const formatter = gitBranchTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({}, 'Branches:');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /list/i);
});

test('git_branch formatter shows create action', t => {
	const formatter = gitBranchTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({create: 'feature/new-branch'}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /create/i);
	t.regex(output!, /feature\/new-branch/);
});

test('git_branch formatter shows switch action', t => {
	const formatter = gitBranchTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({switch: 'main'}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /switch/i);
	t.regex(output!, /main/);
});

test('git_branch formatter shows delete action', t => {
	const formatter = gitBranchTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({delete: 'old-branch'}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /delete/i);
	t.regex(output!, /old-branch/);
});

test('git_branch formatter shows force delete warning', t => {
	const formatter = gitBranchTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({delete: 'feature-branch', force: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /FORCE DELETE/i);
});

test('git_branch formatter shows success message for switch', t => {
	const formatter = gitBranchTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({switch: 'main'}, 'Switched to branch main');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Switch.*completed/i);
});

test('git_branch formatter shows success message for create', t => {
	const formatter = gitBranchTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{create: 'new-branch'},
		'Created and switched to branch new-branch',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Branch created/i);
});

test('git_branch formatter shows success message for delete', t => {
	const formatter = gitBranchTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{delete: 'old-branch'},
		'Deleted branch old-branch',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Branch deleted/i);
});
