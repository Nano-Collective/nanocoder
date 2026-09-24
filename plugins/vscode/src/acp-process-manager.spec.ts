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

/** Like {@link makeManager} but keeps the prototype `start` so tests can drive it. */
function makeManagerWithRealStart(stateManager: AcpStateManager) {
	const outputChannel = { appendLine: () => {} } as any;
	const acpClient = {
		connection: null,
		initializeHandshake: async () => true,
		dispose: () => {}
	} as any as NanocoderAcpClient;
	const manager = new AcpProcessManager(outputChannel, stateManager, acpClient);
	manager.start = AcpProcessManager.prototype.start;
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

test('AcpProcessManager - dispose clears a pending retry timer', async (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManager(stateManager);

	let startedAfterDispose = false;
	manager.start = async () => {
		startedAfterDispose = true;
	};

	(manager as any).retryTimer = setTimeout(() => {
		void manager.start();
	}, 5);

	manager.dispose();

	await new Promise(resolve => setTimeout(resolve, 50));

	t.false(
		startedAfterDispose,
		'dispose() must cancel a pending retry timer',
	);
});

test('AcpProcessManager - start() is a no-op when disposed', async (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManager(stateManager);

	let launchCalled = false;
	(manager as any).launch = async () => {
		launchCalled = true;
	};

	manager.dispose();
	await manager.start();

	t.false(launchCalled, 'start() on a disposed manager must not invoke launch()');
});

test('AcpProcessManager - overlapping start() calls coalesce into one launch', async (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManagerWithRealStart(stateManager);

	let launchCount = 0;
	let releaseLaunch!: () => void;
	(manager as any).launch = () => {
		launchCount++;
		return new Promise<void>(resolve => {
			releaseLaunch = resolve;
		});
	};

	const a = manager.start();
	const b = manager.start();
	const c = manager.start();

	t.is(launchCount, 1, 'overlapping start() callers must share a single in-flight launch');

	releaseLaunch();
	await Promise.all([a, b, c]);

	t.is(launchCount, 1, 'no extra launches should run after the first one resolves');
	t.is(
		(manager as any).currentLaunch,
		null,
		'currentLaunch must be cleared in the finally',
	);
});

test('AcpProcessManager - launch() bails out without spawning when already disposed', async (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManager(stateManager);

	let setConnectionCalls = 0;
	(manager as any).acpClient.setConnection = () => {
		setConnectionCalls++;
	};

	manager.dispose();
	await (AcpProcessManager.prototype as any).launch.call(manager);

	t.is(setConnectionCalls, 0, 'launch() on a disposed manager must not touch acpClient.connection');
	t.is(stateManager.status, ACPStatus.Disconnected, 'launch() must not transition the state manager once disposed');
});

test('AcpProcessManager - _installConnection bails before setConnection when already disposed', async (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManager(stateManager);

	let setConnectionCalls = 0;
	let killed = 0;
	let handshakeCalls = 0;
	(manager as any).acpClient.setConnection = () => {
		setConnectionCalls++;
	};
	(manager as any).acpClient.initializeHandshake = () => {
		handshakeCalls++;
		return Promise.resolve(true);
	};

	const fakeChild = {kill: () => { killed++; return true; }} as any;

	manager.dispose();
	await (AcpProcessManager.prototype as any)._installConnection.call(
		manager, fakeChild, {} as any, () => {},
	);

	t.is(setConnectionCalls, 0, 'setConnection must not run after dispose');
	t.is(handshakeCalls, 0, 'handshake must not run after dispose');
	t.is(killed, 1, 'child must be killed when bailing out');
});

test('AcpProcessManager - _installConnection bails after handshake when disposed mid-flight', async (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManager(stateManager);

	// Pre-seed so we can detect a regression that resets the counter mid-flight.
	(manager as any).retryCount = 3;

	let setConnectionCalls = 0;
	let killed = 0;
	let releaseHandshake!: (value: boolean) => void;
	(manager as any).acpClient.setConnection = () => {
		setConnectionCalls++;
	};
	(manager as any).acpClient.initializeHandshake = () =>
		new Promise<boolean>(resolve => {
			releaseHandshake = resolve;
		});

	const fakeChild = {kill: () => { killed++; return true; }} as any;
	let reportCrashCalled = 0;
	const reportCrash = () => {
		reportCrashCalled++;
	};

	const promise = (AcpProcessManager.prototype as any)._installConnection.call(
		manager, fakeChild, {} as any, reportCrash,
	);

	t.is(setConnectionCalls, 1, 'setConnection runs synchronously before the handshake await');

	// User clicks Restart mid-handshake.
	manager.dispose();
	releaseHandshake(true);
	await promise;

	t.is(setConnectionCalls, 1, 'setConnection must not run a second time after dispose');
	t.is(killed, 1, 'child must be killed when disposed during handshake');
	t.is((manager as any).retryCount, 3, 'retry counter must not be reset by a dispose-during-handshake');
	t.is(reportCrashCalled, 0, 'reportCrash must not fire after dispose');
});

test('AcpProcessManager - _runLaunch swallows errors raised after dispose', async (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManager(stateManager);

	let toastsShown = 0;
	const originalShowError = vscode.window.showErrorMessage;
	(vscode.window as any).showErrorMessage = () => {
		toastsShown++;
		return Promise.resolve(undefined);
	};
	t.teardown(() => {
		(vscode.window as any).showErrorMessage = originalShowError;
	});

	// launch() throws after dispose() has run; the wrapper must not pop a toast
	// for a process the user explicitly killed.
	(manager as any).launch = async () => {
		manager.dispose();
		throw new Error('spawn ENOENT');
	};

	await (AcpProcessManager.prototype as any)._runLaunch.call(manager);

	t.is(toastsShown, 0, 'no error toast must appear when the launch only failed because of a concurrent dispose');
	t.is(stateManager.status, ACPStatus.Disconnected, 'state manager must not be transitioned to Failed by a post-dispose launch failure');
});
