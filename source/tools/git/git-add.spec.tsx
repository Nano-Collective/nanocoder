/**
 * Git Add Tool Tests
 */

import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitAddTool} from './git-add';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-add.spec.tsx – React ${React.version}`);

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

test('git_add tool has correct name', t => {
	t.is(gitAddTool.name, 'git_add');
});

test('git_add tool has AI SDK tool with execute', t => {
	t.truthy(gitAddTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitAddTool.tool as any).execute, 'function');
});

test('git_add tool has formatter function', t => {
	t.is(typeof gitAddTool.formatter, 'function');
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('git_add formatter renders tool name', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({all: true}, 'Staged 3 file(s)');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_add/);
});

test('git_add formatter shows all mode', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({all: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /all/i);
});

test('git_add formatter shows specific files mode', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({files: ['file1.ts', 'file2.ts']}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /2 specific file/i);
});

test('git_add formatter shows update mode', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({update: true}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /tracked files only/i);
});

test('git_add formatter shows staging stats', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({all: true}, 'Staged 5 file(s) (+100, -50)');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /5 files/);
	t.regex(output!, /\+100/);
	t.regex(output!, /-50/);
});

test('git_add formatter shows no changes warning', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({all: true}, 'No changes to stage');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /No changes/i);
});
