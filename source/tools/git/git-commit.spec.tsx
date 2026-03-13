/**
 * Git Commit Tool Tests
 */

import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitCommitTool} from './git-commit';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-commit.spec.tsx – React ${React.version}`);

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

test('git_commit tool has correct name', t => {
	t.is(gitCommitTool.name, 'git_commit');
});

test('git_commit tool has AI SDK tool with execute', t => {
	t.truthy(gitCommitTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitCommitTool.tool as any).execute, 'function');
});

test('git_commit tool has formatter function', t => {
	t.is(typeof gitCommitTool.formatter, 'function');
});

test('git_commit tool has validator function', t => {
	t.is(typeof gitCommitTool.validator, 'function');
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('git_commit formatter renders tool name', t => {
	const formatter = gitCommitTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{message: 'feat: add new feature'},
		'Commit created: abc1234',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_commit/);
});

test('git_commit formatter shows commit message', t => {
	const formatter = gitCommitTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({message: 'feat: add new feature'}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /feat: add new feature/);
});

test('git_commit formatter shows body', t => {
	const formatter = gitCommitTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{message: 'feat: test', body: 'This is the body of the commit'},
		'',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Body/i);
	t.regex(output!, /This is the body/);
});

test('git_commit formatter shows amend warning', t => {
	const formatter = gitCommitTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({message: 'fix: test', amend: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /amend/i);
});

test('git_commit formatter shows noVerify indicator', t => {
	const formatter = gitCommitTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({message: 'test', noVerify: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /skipped/i);
});

test('git_commit formatter shows success message', t => {
	const formatter = gitCommitTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{message: 'feat: test'},
		'Commit created: abc1234',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Commit created/i);
});

// ============================================================================
// Validator Tests
// ============================================================================

test('git_commit validator rejects empty message', async t => {
	const validator = gitCommitTool.validator;
	if (!validator) {
		t.fail('Validator is not defined');
		return;
	}

	const result = await validator({message: ''});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /empty/i);
	}
});

test('git_commit validator rejects whitespace-only message', async t => {
	const validator = gitCommitTool.validator;
	if (!validator) {
		t.fail('Validator is not defined');
		return;
	}

	const result = await validator({message: '   '});
	t.false(result.valid);
});
