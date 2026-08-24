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

test('git_pr tool is NOT marked read-only, even though it bundles read-only actions', t => {
	// In yolo mode, resolveToolApproval bypasses the `approval` fn entirely
	// (mode === 'yolo' short-circuits to "no approval needed" for every
	// tool), so a mutating action (create/comment/review) can reach the same
	// auto-executed path as view/list/diff/checks/logs. If this tool were
	// readOnly: true, tool-executor.tsx's classifyTool() would then be free
	// to batch consecutive git_pr calls into a parallel Promise.all group —
	// including mutating ones — instead of running them one at a time. See
	// the comment on the export in git-pr.tsx.
	t.falsy(gitPrTool.readOnly);
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

// ============================================================================
// New Action Formatter Tests (diff/comment/review/checks/logs)
// ============================================================================

test('git_pr formatter shows diff action', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({diff: 42}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /diff/i);
	t.regex(output!, /#42/);
});

test('git_pr formatter shows comment action with body', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{comment: {pr: 7, body: 'Looks good to me'}},
		'',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /comment/i);
	t.regex(output!, /#7/);
	t.regex(output!, /Looks good to me/);
});

test('git_pr formatter shows review action with verdict', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{review: {pr: 9, verdict: 'request-changes', body: 'Needs a test'}},
		'',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /review/i);
	t.regex(output!, /#9/);
	t.regex(output!, /request-changes/);
	t.regex(output!, /Needs a test/);
});

test('git_pr formatter shows checks action', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({checks: {pr: 3}}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /checks/i);
	t.regex(output!, /#3/);
});

test('git_pr formatter shows logs action resolved by PR', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({logs: {pr: 5, search: 'Error'}}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /logs/i);
	t.regex(output!, /#5/);
	t.regex(output!, /Error/);
});

test('git_pr formatter shows logs action resolved by explicit run', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({logs: {run: 123456}}, '');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /123456/);
});

// ============================================================================
// Approval Policy Tests
// ============================================================================

test('git_pr approval requires confirmation for create', t => {
	const approval = gitPrTool.approval;
	t.is(typeof approval, 'function');
	if (typeof approval !== 'function') return;
	t.true(Boolean(approval({create: {title: 'x'}}, 'normal')));
});

test('git_pr approval requires confirmation for comment', t => {
	const approval = gitPrTool.approval;
	if (typeof approval !== 'function') {
		t.fail('approval is not a function');
		return;
	}
	t.true(Boolean(approval({comment: {pr: 1, body: 'x'}}, 'normal')));
});

test('git_pr approval requires confirmation for review', t => {
	const approval = gitPrTool.approval;
	if (typeof approval !== 'function') {
		t.fail('approval is not a function');
		return;
	}
	t.true(
		Boolean(approval({review: {pr: 1, verdict: 'approve'}}, 'normal')),
	);
});

test('git_pr approval auto-runs read-only actions', t => {
	const approval = gitPrTool.approval;
	if (typeof approval !== 'function') {
		t.fail('approval is not a function');
		return;
	}
	t.false(Boolean(approval({view: 1}, 'normal')));
	t.false(Boolean(approval({list: {}}, 'normal')));
	t.false(Boolean(approval({diff: 1}, 'normal')));
	t.false(Boolean(approval({checks: {pr: 1}}, 'normal')));
	t.false(Boolean(approval({logs: {pr: 1}}, 'normal')));
});
