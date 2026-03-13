/**
 * Git PR Tool Tests
 */

import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitPrTool} from './git-pr';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-pr.spec.tsx – React ${React.version}`);

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

test('git_pr tool has correct name', t => {
	t.is(gitPrTool.name, 'git_pr');
});

test('git_pr tool has AI SDK tool with execute', t => {
	t.truthy(gitPrTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitPrTool.tool as any).execute, 'function');
});

test('git_pr tool has formatter function', t => {
	t.is(typeof gitPrTool.formatter, 'function');
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('git_pr formatter renders tool name', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({list: {}}, 'Pull requests:');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_pr/);
});

test('git_pr formatter shows create action', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({create: {title: 'Add new feature'}}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /create/i);
});

test('git_pr formatter shows PR title', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({create: {title: 'Add new feature'}}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Add new feature/);
});

test('git_pr formatter shows draft indicator', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{create: {title: 'WIP', draft: true}},
		'',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /draft/i);
});

test('git_pr formatter shows view action', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({view: 123}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /view/i);
	t.regex(output!, /#123/);
});

test('git_pr formatter shows list action', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({list: {}}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /list/i);
});

test('git_pr formatter shows list state filter', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({list: {state: 'closed'}}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /closed/i);
});

test('git_pr formatter shows list author filter', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({list: {author: '@me'}}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /@me/);
});

test('git_pr formatter shows success message', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{create: {title: 'Test PR'}},
		'Pull request created successfully!',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /PR created/i);
});

test('git_pr formatter shows PR body', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{create: {title: 'Test', body: 'This is the PR description'}},
		'',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Body/i);
	t.regex(output!, /This is the PR description/);
});
