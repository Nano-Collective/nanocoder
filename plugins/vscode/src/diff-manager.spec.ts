import test from 'ava';
import * as vscode from 'vscode';
import { DiffManager, diffChangeId } from './diff-manager';
import { ChatWebviewProvider } from './chat-webview-provider';
import { NanocoderAcpClient } from './acp-client';

// The vscode stub has no content provider registry, URI parser or tab groups.
// DiffManager touches all three, so provide minimal versions for this file.
// Ava runs each spec file in its own process, so these patches do not leak.
// The stub-only test hooks are not part of @types/vscode, so reach them through
// a typed alias instead of `any`.
const stub = vscode as unknown as typeof vscode & {
	__test: {
		reset(): void;
		executeCommand: (command: string, ...args: unknown[]) => Promise<unknown>;
	};
};
const noopDisposable = {dispose: () => {}};
(vscode.workspace as any).registerTextDocumentContentProvider = () => noopDisposable;
(vscode.Uri as any).parse = (value: string) => vscode.Uri.file(value);
(vscode.window as any).tabGroups = {all: [], close: async () => true};

function makeContext() {
	return {subscriptions: [] as {dispose(): void}[]} as any;
}

test.beforeEach(() => {
	stub.__test.reset();
	(vscode.window as any).activeTerminal = undefined;
});

test('diffChangeId keeps distinct files under one tool call apart', t => {
	const a = diffChangeId('call-1', 'src/a.ts');
	const b = diffChangeId('call-1', 'src/b.ts');
	t.not(a, b);
});

test('diffChangeId normalizes equivalent paths to the same key', t => {
	t.is(diffChangeId('call-1', 'src/../src/a.ts'), diffChangeId('call-1', 'src/a.ts'));
});

test('diffChangeId separates the same path under different tool calls', t => {
	t.not(diffChangeId('call-1', 'a.ts'), diffChangeId('call-2', 'a.ts'));
});

test('a tool call with two diff blocks registers both changes', t => {
	const diffManager = new DiffManager(makeContext());
	const acpClient = {} as NanocoderAcpClient;
	const provider = new ChatWebviewProvider(
		vscode.Uri.file('/fake'),
		{appendLine: () => {}} as any,
		acpClient,
		diffManager,
	);

	(provider as any).handleDiffs({
		update: {
			toolCallId: 'call-1',
			title: 'Edit files',
			content: [
				{type: 'diff', path: '/repo/a.ts', oldText: 'a', newText: 'A'},
				{type: 'diff', path: '/repo/b.ts', oldText: 'b', newText: 'B'},
			],
		},
	});

	const changes = diffManager.getPendingChanges();
	t.is(changes.length, 2);
	t.deepEqual(
		changes.map(change => change.filePath).sort(),
		['/repo/a.ts', '/repo/b.ts'],
	);
});

test('showDiff from chat does not move focus to the terminal', async t => {
	const diffManager = new DiffManager(makeContext());
	const commandsRun: string[] = [];
	stub.__test.executeCommand = async (command: string) => {
		commandsRun.push(command);
	};
	(vscode.window as any).activeTerminal = {name: 'shell'};

	(diffManager as any).addPendingChange({
		type: 'file_change',
		id: diffChangeId('call-1', '/repo/a.ts'),
		filePath: '/repo/a.ts',
		originalContent: 'old',
		newContent: 'new',
		toolName: 'edit',
		toolArgs: {},
	});

	await diffManager.showDiff(diffChangeId('call-1', '/repo/a.ts'), false);

	t.true(commandsRun.includes('vscode.diff'));
	t.false(commandsRun.includes('workbench.action.terminal.focus'));
});

test('showDiff for a new file from chat does not move focus to the terminal', async t => {
	const diffManager = new DiffManager(makeContext());
	const commandsRun: string[] = [];
	stub.__test.executeCommand = async (command: string) => {
		commandsRun.push(command);
	};
	(vscode.window as any).activeTerminal = {name: 'shell'};

	(diffManager as any).addPendingChange({
		type: 'file_change',
		id: diffChangeId('call-1', '/repo/new.ts'),
		filePath: '/repo/new.ts',
		originalContent: '',
		newContent: 'export const x = 1;',
		toolName: 'write',
		toolArgs: {},
	});

	await diffManager.showDiff(diffChangeId('call-1', '/repo/new.ts'), false);

	t.false(commandsRun.includes('workbench.action.terminal.focus'));
});

test('showDiff for a new file with default focus behaviour still restores the terminal', async t => {
	const diffManager = new DiffManager(makeContext());
	const commandsRun: string[] = [];
	stub.__test.executeCommand = async (command: string) => {
		commandsRun.push(command);
	};
	(vscode.window as any).activeTerminal = {name: 'shell'};

	(diffManager as any).addPendingChange({
		type: 'file_change',
		id: 'new-change-1',
		filePath: '/repo/new.ts',
		originalContent: '',
		newContent: 'export const x = 1;',
		toolName: 'write',
		toolArgs: {},
	});

	await diffManager.showDiff('new-change-1');

	t.true(commandsRun.includes('workbench.action.terminal.focus'));
});

test('showDiff with default focus behaviour still restores the terminal', async t => {
	const diffManager = new DiffManager(makeContext());
	const commandsRun: string[] = [];
	stub.__test.executeCommand = async (command: string) => {
		commandsRun.push(command);
	};
	(vscode.window as any).activeTerminal = {name: 'shell'};

	(diffManager as any).addPendingChange({
		type: 'file_change',
		id: 'change-1',
		filePath: '/repo/a.ts',
		originalContent: 'old',
		newContent: 'new',
		toolName: 'edit',
		toolArgs: {},
	});

	await diffManager.showDiff('change-1');

	t.true(commandsRun.includes('workbench.action.terminal.focus'));
});

test('clearPendingChanges drops every change and notifies listeners', async t => {
	const diffManager = new DiffManager(makeContext());
	let notified = 0;
	diffManager.onChanges(() => {
		notified++;
	});

	for (const id of ['call-1_a.ts', 'call-2_b.ts']) {
		(diffManager as any).addPendingChange({
			type: 'file_change',
			id,
			filePath: id,
			originalContent: 'old',
			newContent: 'new',
			toolName: 'edit',
			toolArgs: {},
		});
	}
	// Count only the clear's notifications; the adds above are not under test.
	notified = 0;

	await diffManager.clearPendingChanges();

	t.is(diffManager.getPendingChanges().length, 0);
	t.is(notified, 1, 'clearing a non-empty set notifies exactly once');
});

test('clearPendingChanges is a no-op when nothing is pending', async t => {
	const diffManager = new DiffManager(makeContext());
	let notified = 0;
	diffManager.onChanges(() => {
		notified++;
	});

	await diffManager.clearPendingChanges();

	t.is(notified, 0);
});
