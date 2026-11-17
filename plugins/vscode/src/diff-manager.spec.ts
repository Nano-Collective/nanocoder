import test from 'ava';
import * as vscode from 'vscode';
import { DiffManager } from './diff-manager';
import type { FileChangeMessage } from './protocol';

function setupDiffManager() {
	const context = { subscriptions: [] } as any as vscode.ExtensionContext;
	const diffManager = new DiffManager(context);

	const executedCommands: Array<{ command: string; args: unknown[] }> = [];
	(vscode as any).__test.executeCommand = async (command: string, ...args: unknown[]) => {
		executedCommands.push({ command, args });
	};

	return {
		diffManager,
		executedCommands,
	};
}

function createPendingChange(overrides: Partial<FileChangeMessage> & { id: string; filePath: string }): FileChangeMessage {
	return {
		type: 'file_change',
		originalContent: 'old',
		newContent: 'new',
		toolName: 'edit',
		toolArgs: {},
		...overrides,
	};
}

test('DiffManager - showDiff falls back to prefix matching when called with bare toolCallId', async (t) => {
	const { diffManager, executedCommands } = setupDiffManager();

	diffManager.addPendingChange(createPendingChange({
		id: 'tool-call-abc_src/a.ts',
		filePath: 'src/a.ts',
		originalContent: 'old a',
		newContent: 'new a',
	}));
	diffManager.addPendingChange(createPendingChange({
		id: 'tool-call-abc_src/b.ts',
		filePath: 'src/b.ts',
		originalContent: 'old b',
		newContent: 'new b',
	}));

	// Call showDiff with bare toolCallId (no exact match exists)
	await diffManager.showDiff('tool-call-abc');

	const diffCommands = executedCommands.filter(c => c.command === 'vscode.diff');
	t.is(diffCommands.length, 2, 'showDiff must open diff views for all compound changes sharing the toolCallId prefix');
	t.truthy(diffManager.getPendingChange('tool-call-abc'), 'getPendingChange must also find change by prefix');
});

test('DiffManager - showDiff with filePath opens only the matching change', async (t) => {
	const { diffManager, executedCommands } = setupDiffManager();

	diffManager.addPendingChange(createPendingChange({
		id: 'tool-call-abc_src/a.ts',
		filePath: 'src/a.ts',
		originalContent: 'old a',
		newContent: 'new a',
	}));
	diffManager.addPendingChange(createPendingChange({
		id: 'tool-call-abc_src/b.ts',
		filePath: 'src/b.ts',
		originalContent: 'old b',
		newContent: 'new b',
	}));

	await diffManager.showDiff('tool-call-abc', { filePath: 'src/b.ts' });

	const diffCommands = executedCommands.filter(c => c.command === 'vscode.diff');
	t.is(diffCommands.length, 1, 'showDiff with filePath must open only the matching change');
	t.is(diffManager.getPendingChange('tool-call-abc', 'src/b.ts')?.filePath, 'src/b.ts');
});

test('DiffManager - closeDiff removes all compound changes sharing toolCallId prefix', async (t) => {
	const { diffManager } = setupDiffManager();

	diffManager.addPendingChange(createPendingChange({
		id: 'tool-call-xyz_src/a.ts',
		filePath: 'src/a.ts',
	}));
	diffManager.addPendingChange(createPendingChange({
		id: 'tool-call-xyz_src/b.ts',
		filePath: 'src/b.ts',
	}));

	t.is(diffManager.getPendingChanges().length, 2);

	await diffManager.closeDiff('tool-call-xyz');

	t.is(diffManager.getPendingChanges().length, 0, 'closeDiff must remove all matching changes by prefix');
});

test('DiffManager - clearPendingChanges empties all tracked changes', async (t) => {
	const { diffManager } = setupDiffManager();

	diffManager.addPendingChange(createPendingChange({
		id: 'call-1_src/a.ts',
		filePath: 'src/a.ts',
	}));
	diffManager.addPendingChange(createPendingChange({
		id: 'call-2_src/b.ts',
		filePath: 'src/b.ts',
	}));

	t.is(diffManager.getPendingChanges().length, 2);

	await diffManager.clearPendingChanges();

	t.is(diffManager.getPendingChanges().length, 0, 'clearPendingChanges must empty pendingChanges');
});

test('DiffManager - restoreTerminalFocus option controls terminal focus restoration', async (t) => {
	const { diffManager, executedCommands } = setupDiffManager();

	(vscode.window as any).activeTerminal = { name: 'Terminal' };

	diffManager.addPendingChange(createPendingChange({
		id: 'change-1',
		filePath: 'src/foo.ts',
	}));

	// Webview / default behavior: restoreTerminalFocus is false
	await diffManager.showDiff('change-1');
	t.false(
		executedCommands.some(c => c.command === 'workbench.action.terminal.focus'),
		'showDiff without restoreTerminalFocus must not focus terminal',
	);

	executedCommands.length = 0;

	// CLI companion behavior: restoreTerminalFocus is true
	await diffManager.showDiff('change-1', { restoreTerminalFocus: true });
	t.true(
		executedCommands.some(c => c.command === 'workbench.action.terminal.focus'),
		'showDiff with restoreTerminalFocus: true must focus terminal',
	);

	(vscode.window as any).activeTerminal = undefined;
});
