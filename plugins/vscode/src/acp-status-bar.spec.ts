import test from 'ava';
import * as vscode from 'vscode';
import {AcpStateManager, ACPStatus} from './acp-state';
import {
	AcpStatusBarController,
	describeAcpStatus,
} from './acp-status-bar';

// -- describeAcpStatus (pure) ------------------------------------------------

test('describeAcpStatus - connected keeps text stable and surfaces model in tooltip', (t) => {
	const withModel = describeAcpStatus(ACPStatus.Connected, undefined, 'qwen3:8b');
	t.is(withModel.text, '$(check) Nanocoder', 'text never carries the model');
	t.regex(withModel.tooltip, /qwen3:8b/, 'model lives in the tooltip');

	const withoutModel = describeAcpStatus(ACPStatus.Connected, undefined, undefined);
	t.is(withoutModel.text, '$(check) Nanocoder');
	t.false(withoutModel.tooltip.includes('undefined'), 'tooltip falls back cleanly');
});

test('describeAcpStatus - starting shows the spin state with no click action', (t) => {
	const view = describeAcpStatus(ACPStatus.Starting, undefined, undefined);
	t.regex(view.text, /Starting/);
	t.regex(view.text, /\$\(sync~spin\)/);
	t.is(view.command, undefined, 'Nothing to recover from while spawning');
});

test('describeAcpStatus - restarting includes the attempt counter', (t) => {
	const view = describeAcpStatus(
		ACPStatus.Restarting,
		{attempt: 3, totalAttempts: 5},
		undefined,
	);
	t.regex(view.text, /Reconnecting \(3\/5\)/);

	// Detail is optional; the counter just disappears without it.
	const bare = describeAcpStatus(ACPStatus.Restarting, undefined, undefined);
	t.regex(bare.text, /Reconnecting/);
	t.false(/\(\d\/\d\)/.test(bare.text), 'no attempt counter without detail');
});

test('describeAcpStatus - failed carries the last error and a recovery command', (t) => {
	const view = describeAcpStatus(
		ACPStatus.Failed,
		{reason: 'EADDRINUSE'},
		undefined,
	);
	t.regex(view.text, /Failed/);
	t.regex(view.tooltip, /EADDRINUSE/);
	t.is(view.command, 'nanocoder.showOutput');
});

test('describeAcpStatus - cli missing points at restart for the retry', (t) => {
	const view = describeAcpStatus(ACPStatus.CliMissing, undefined, undefined);
	t.regex(view.text, /Not installed/);
	t.is(view.command, 'nanocoder.restartAcp');
});

// -- AcpStatusBarController (rendering via the stub item) --------------------

function makeItem(): vscode.StatusBarItem & {updates: number} {
	const item = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	) as vscode.StatusBarItem & {updates: number};
	item.updates = 0;
	const values: Record<string, unknown> = {};
	for (const key of ['text', 'tooltip', 'command'] as const) {
		Object.defineProperty(item, key, {
			get: () => values[key],
			set: (value: unknown) => {
				values[key] = value;
				item.updates++;
			},
		});
	}
	return item;
}

function makeOutputChannel(): vscode.OutputChannel {
	return {show: () => {}} as unknown as vscode.OutputChannel;
}

test('AcpStatusBarController - renders the current state on construction', (t) => {
	const stateManager = new AcpStateManager();
	stateManager.setStatus(ACPStatus.Restarting, {attempt: 1, totalAttempts: 5});
	const item = makeItem();

	// activate() starts the ACP process before creating the controller, so the
	// initial state must be visible immediately, not after the next transition.
	new AcpStatusBarController(item, stateManager, makeOutputChannel());
	t.regex(item.text, /Reconnecting \(1\/5\)/);
});

test('AcpStatusBarController - follows status transitions', (t) => {
	const stateManager = new AcpStateManager();
	const item = makeItem();
	new AcpStatusBarController(item, stateManager, makeOutputChannel());

	stateManager.setStatus(ACPStatus.Starting);
	t.regex(item.text, /Starting/);

	stateManager.setStatus(ACPStatus.Connected);
	t.regex(item.text, /Nanocoder/);

	stateManager.setStatus(ACPStatus.Restarting, {attempt: 2, totalAttempts: 5});
	t.regex(item.text, /Reconnecting \(2\/5\)/);

	stateManager.setStatus(ACPStatus.Failed, {reason: 'boom'});
	t.regex(item.text, /Failed/);
});

test('AcpStatusBarController - model update flows through to the tooltip', (t) => {
	const stateManager = new AcpStateManager();
	const item = makeItem();
	const controller = new AcpStatusBarController(item, stateManager, makeOutputChannel());

	stateManager.setStatus(ACPStatus.Connected);
	controller.setModel('llama3.2');
	t.is(item.text, '$(check) Nanocoder', 'text stays the same on model sync');
	t.regex(String(item.tooltip ?? ''), /llama3\.2/);

	// Model updates must not surface for non-connected states.
	controller.setModel('other-model');
	stateManager.setStatus(ACPStatus.Starting);
	t.false(
		String(item.tooltip ?? '').includes('other-model'),
		'model must not leak into non-connected tooltips',
	);
});

test('AcpStatusBarController - Failed opens the recovery dialog once and handles Restart', async (t) => {
	const stateManager = new AcpStateManager();
	const item = makeItem();
	new AcpStatusBarController(item, stateManager, makeOutputChannel());

	const originalShowError = vscode.window.showErrorMessage;
	const originalExecute = vscode.commands.executeCommand;
	const shown: string[] = [];
	const executed: string[] = [];
	(vscode.window as any).showErrorMessage = async (...args: unknown[]) => {
		shown.push(args[0] as string);
		return 'Restart';
	};
	(vscode.commands as any).executeCommand = async (command: string) => {
		executed.push(command);
	};
	t.teardown(() => {
		(vscode.window as any).showErrorMessage = originalShowError;
		(vscode.commands as any).executeCommand = originalExecute;
	});

	stateManager.setStatus(ACPStatus.Failed, {reason: 'kaboom'});
	// Second transition to Failed while the first dialog is pending: must not stack.
	stateManager.setStatus(ACPStatus.Failed, {reason: 'kaboom again'});

	await new Promise((resolve) => setTimeout(resolve, 0));

	t.is(shown.length, 1, 'A second Failed event must not stack a second dialog');
	t.regex(shown[0], /kaboom/);
	t.deepEqual(executed, ['nanocoder.restartAcp']);
});
