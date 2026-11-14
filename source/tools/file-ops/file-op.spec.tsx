import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../../config/themes.js';
import {ThemeContext} from '../../hooks/useTheme.js';
import {
	resetFirewallConfig,
	setFirewallConfig,
} from '../../firewall/mutation-firewall.js';
import {
	resetSessionCwd,
	setProjectRoot,
	setSessionCwd,
} from '../../services/session-cwd.js';
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

(process.platform === 'win32' ? test.skip : test)(
	'file_op validator: copy onto a dangling symlink that points outside is rejected',
	async t => {
		const outside = await mkdtemp(join(tmpdir(), 'file-op-outside-'));
		try {
			setProjectRoot(workspace);
			// copyFile follows a dangling destination link and creates its target.
			await symlink(join(outside, 'authorized_keys'), join(workspace, 'notes.md'));
			const result = await fileOpTool.validator?.({
				operation: 'copy',
				path: 'greet.py',
				destination: 'notes.md',
			});
			t.false(result?.valid);
			if (result && !result.valid) {
				t.regex(result.error, /escapes project directory via symlink/);
			}
		} finally {
			await rm(outside, {recursive: true, force: true});
		}
	},
);

test('file_op approval: mkdir runs in auto-accept', async t => {
	t.false(await needsApproval({operation: 'mkdir', path: 'src'}, 'auto-accept'));
	t.false(
		await needsApproval({operation: 'mkdir', path: 'greet.py'}, 'auto-accept'),
		'mkdir never replaces anything, even when the path exists',
	);
});

// ============================================================================
// Mutation firewall: delete, move and copy change paths too, so a protected
// pattern has to hold for them as it does for write_file and the editors.
// ============================================================================

const runFileOp = (args: Record<string, unknown>): Promise<string> =>
	// biome-ignore lint/suspicious/noExplicitAny: Tool internals require any
	(fileOpTool.tool as any).execute(args, {toolCallId: 'test', messages: []});

test.serial('file_op firewall: strict mode refuses to delete a protected file', async t => {
	setProjectRoot(workspace);
	setFirewallConfig({mode: 'strict', protectedPatterns: ['greet.py']});
	t.teardown(() => resetFirewallConfig());
	await t.throwsAsync(runFileOp({operation: 'delete', path: 'greet.py'}), {
		message: /\[Mutation Firewall\] Blocked mutation/,
	});
	t.true(existsSync(join(workspace, 'greet.py')));
});

test.serial('file_op firewall: strict mode refuses to move a protected file away or onto one', async t => {
	setProjectRoot(workspace);
	setFirewallConfig({mode: 'strict', protectedPatterns: ['greet.py']});
	t.teardown(() => resetFirewallConfig());
	await t.throwsAsync(
		runFileOp({operation: 'move', path: 'greet.py', destination: 'moved.py'}),
		{message: /Blocked mutation/},
	);
	await t.throwsAsync(
		runFileOp({operation: 'move', path: 'other.py', destination: 'greet.py'}),
		{message: /Blocked mutation/},
	);
	t.true(existsSync(join(workspace, 'greet.py')));
	t.true(existsSync(join(workspace, 'other.py')));
});

test.serial('file_op firewall: copy may read a protected file but not overwrite one', async t => {
	setProjectRoot(workspace);
	setFirewallConfig({mode: 'strict', protectedPatterns: ['greet.py']});
	t.teardown(() => resetFirewallConfig());
	await t.throwsAsync(
		runFileOp({operation: 'copy', path: 'other.py', destination: 'greet.py'}),
		{message: /Blocked mutation/},
	);
	t.is(await readFile(join(workspace, 'greet.py'), 'utf-8'), "print('Hello, Agent!')\n");
	const result = await runFileOp({
		operation: 'copy',
		path: 'greet.py',
		destination: 'copy.py',
	});
	t.regex(result, /^File copied/);
	t.notRegex(result, /Mutation Firewall/);
});

test.serial('file_op firewall: lenient mode deletes but reports the violation', async t => {
	setProjectRoot(workspace);
	setFirewallConfig({mode: 'lenient', protectedPatterns: ['greet.py']});
	t.teardown(() => resetFirewallConfig());
	const result = await runFileOp({operation: 'delete', path: 'greet.py'});
	t.false(existsSync(join(workspace, 'greet.py')));
	t.regex(result, /^File deleted: greet\.py/);
	t.regex(result, /\[Mutation Firewall\] Warning \(lenient mode/);
});
