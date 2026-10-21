import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../../config/themes.js';
import {ThemeContext} from '../../hooks/useTheme.js';
import {resetSessionCwd, setSessionCwd} from '../../services/session-cwd.js';
import type {DevelopmentMode} from '../../types/core.js';
import {resolveToolApproval} from '../approval-policy.js';
import {fileOpTool} from './file-op.js';

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

test('file_op formatter renders description when provided', async t => {
	const formatter = fileOpTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = await formatter({
		operation: 'delete',
		path: 'old-file.txt',
		description: 'Remove deprecated configuration file.',
	});

	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Description:/);
	t.regex(output!, /Remove deprecated configuration file\./);
	t.regex(output!, /Operation:/);
	t.regex(output!, /delete/);
});

test('file_op formatter does not render description when omitted', async t => {
	const formatter = fileOpTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = await formatter({
		operation: 'delete',
		path: 'old-file.txt',
	});

	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Description:/);
	t.regex(output!, /Operation:/);
	t.regex(output!, /delete/);
});

// ============================================================================
// Approval (#1683): auto-accept waives approval for file edits, but a delete,
// or a move/copy onto an existing file, cannot be reviewed or undone, so those
// still prompt there - the same as `rm` through execute_bash.
// ============================================================================

let workspace: string;

test.beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), 'file-op-approval-'));
	setSessionCwd(workspace);
	await writeFile(join(workspace, 'greet.py'), "print('Hello, Agent!')\n");
	await writeFile(join(workspace, 'other.py'), "print('other')\n");
});

test.afterEach.always(async () => {
	resetSessionCwd();
	await rm(workspace, {recursive: true, force: true});
});

const needsApproval = (
	args: Record<string, unknown>,
	mode: DevelopmentMode,
	alwaysAllow: string[] = [],
) => resolveToolApproval('file_op', fileOpTool, args, {mode, alwaysAllow});

test('file_op approval: delete prompts in auto-accept', async t => {
	t.true(await needsApproval({operation: 'delete', path: 'greet.py'}, 'auto-accept'));
});

test('file_op approval: delete still prompts in normal', async t => {
	t.true(await needsApproval({operation: 'delete', path: 'greet.py'}, 'normal'));
});

test('file_op approval: delete keeps the architect and headless postures', async t => {
	const args = {operation: 'delete', path: 'greet.py'};
	t.false(await needsApproval(args, 'architect'), 'architect checkpoints it');
	t.false(await needsApproval(args, 'headless'), 'headless has no one to ask');
	t.false(await needsApproval(args, 'yolo'));
});

test('file_op approval: alwaysAllow pre-authorizes a delete in auto-accept', async t => {
	t.false(
		await needsApproval({operation: 'delete', path: 'greet.py'}, 'auto-accept', [
			'file_op',
		]),
	);
});

for (const operation of ['move', 'copy']) {
	test(`file_op approval: ${operation} onto an existing file prompts in auto-accept`, async t => {
		t.true(
			await needsApproval(
				{operation, path: 'greet.py', destination: 'other.py'},
				'auto-accept',
			),
		);
	});

	test(`file_op approval: ${operation} to a new path runs in auto-accept`, async t => {
		t.false(
			await needsApproval(
				{operation, path: 'greet.py', destination: 'new.py'},
				'auto-accept',
			),
		);
	});

	test(`file_op approval: ${operation} onto an existing file keeps the architect and headless postures`, async t => {
		const args = {operation, path: 'greet.py', destination: 'other.py'};
		t.false(await needsApproval(args, 'architect'));
		t.false(await needsApproval(args, 'headless'));
	});
}

test('file_op approval: a dangling symlink at the destination counts as existing', async t => {
	await symlink(join(workspace, 'missing.py'), join(workspace, 'link.py'));
	t.true(
		await needsApproval(
			{operation: 'move', path: 'greet.py', destination: 'link.py'},
			'auto-accept',
		),
	);
});

test('file_op approval: mkdir runs in auto-accept', async t => {
	t.false(await needsApproval({operation: 'mkdir', path: 'src'}, 'auto-accept'));
	t.false(
		await needsApproval({operation: 'mkdir', path: 'greet.py'}, 'auto-accept'),
		'mkdir never replaces anything, even when the path exists',
	);
});
