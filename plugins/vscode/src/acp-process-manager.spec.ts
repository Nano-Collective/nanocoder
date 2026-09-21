import test from 'ava';
import * as vscode from 'vscode';
import { AcpProcessManager } from './acp-process-manager';
import { AcpStateManager, ACPStatus } from './acp-state';
import { NanocoderAcpClient } from './acp-client';

function makeManager(stateManager: AcpStateManager) {
	const outputChannel = { appendLine: () => {} } as any;
	const acpClient = {
		connection: null,
		initializeHandshake: async () => true,
		dispose: () => {}
	} as any as NanocoderAcpClient;
	const manager = new AcpProcessManager(outputChannel, stateManager, acpClient);
	// Mock start to just simulate starting
	manager.start = async () => {};
	return manager;
}

test('AcpProcessManager - restart logic and retry backoff', (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManager(stateManager);

	// Manually trigger restart
	(manager as any).handleCrash();

	// First retry attempt should happen immediately (delay = 0)
	// We can't strictly assert the setTimeout without a timer mock, but we can verify retryCount increments
	t.is((manager as any).retryCount, 1, 'retryCount should be incremented to 1');
	t.is(stateManager.status, ACPStatus.Restarting, 'status should be Restarting');
	t.deepEqual(
		stateManager.detail,
		{attempt: 1, totalAttempts: 5},
		'status detail should carry the attempt counter for the status bar',
	);
});

test('AcpProcessManager - exhausting retries transitions to Failed with the last stderr line', (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManager(stateManager);
	(manager as any).lastStderr = 'first failure\nEADDRINUSE: address already in use';

	const originalShowError = vscode.window.showErrorMessage;
	const shown: string[] = [];
	(vscode.window as any).showErrorMessage = (message: string) => {
		shown.push(message);
	};
	t.teardown(() => {
		(vscode.window as any).showErrorMessage = originalShowError;
	});

	const maxRetries = (manager as any).maxRetries as number;
	for (let i = 0; i < maxRetries; i++) {
		(manager as any).handleCrash();
	}
	t.is(stateManager.status, ACPStatus.Restarting, 'still auto-restarting before the limit');

	(manager as any).handleCrash();
	t.is(stateManager.status, ACPStatus.Failed, 'exhausted retries surface as Failed, not Disconnected');
	t.is((stateManager.detail as {reason?: string}).reason, 'EADDRINUSE: address already in use',
		'Failed detail should carry the last stderr line for the recovery dialog');
	t.is(shown.length, 1, 'the max-retries dialog still fires');
});

test('AcpProcessManager - dispose keeps the shared state manager usable', (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManager(stateManager);

	manager.dispose();

	// nanocoder.restartAcp disposes and rebuilds the manager while keeping the
	// state manager (the webview and status bar hold it too). Disposing the
	// emitter here would kill those subscriptions on every manual restart.
	let fired = false;
	stateManager.onDidChangeStatus(() => {
		fired = true;
	});
	stateManager.setStatus(ACPStatus.Connected);
	t.true(fired, 'onDidChangeStatus must survive a manager dispose');
});
