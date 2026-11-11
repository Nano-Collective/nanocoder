import test, {type ExecutionContext} from 'ava';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

test('AcpProcessManager - ensureStarted() launches once, however often it is called', async (t) => {
	const manager = makeManagerWithRealStart(new AcpStateManager());
	let launchCount = 0;
	(manager as any).launch = async () => {
		launchCount++;
	};

	const first = manager.ensureStarted();
	const second = manager.ensureStarted();
	await Promise.all([first, second]);
	// The first launch has finished, which is when start() alone would spawn again.
	await manager.ensureStarted();

	t.is(launchCount, 1, 'only the first call may spawn the agent process');
});

test('AcpProcessManager - ensureStarted() resolves with the launch it joined', async (t) => {
	const manager = makeManagerWithRealStart(new AcpStateManager());
	let releaseLaunch!: () => void;
	(manager as any).launch = () =>
		new Promise<void>(resolve => {
			releaseLaunch = resolve;
		});

	let joinedResolved = false;
	void manager.ensureStarted();
	const joined = manager.ensureStarted().then(() => {
		joinedResolved = true;
	});
	await Promise.resolve();
	t.false(joinedResolved, 'a caller joining an in-flight launch waits for it');

	releaseLaunch();
	await joined;
	t.true(joinedResolved);
});

test('AcpProcessManager - ensureStarted() is a no-op once start() has run', async (t) => {
	const manager = makeManagerWithRealStart(new AcpStateManager());
	let launchCount = 0;
	(manager as any).launch = async () => {
		launchCount++;
	};

	// e.g. "Restart Agent Process" before the chat view was ever opened.
	await manager.start();
	await manager.ensureStarted();

	t.is(launchCount, 1);
});

test('AcpProcessManager - ensureStarted() does nothing on a disposed manager', async (t) => {
	const manager = makeManagerWithRealStart(new AcpStateManager());
	let launchCount = 0;
	(manager as any).launch = async () => {
		launchCount++;
	};

	manager.dispose();
	await manager.ensureStarted();

	t.is(launchCount, 0);
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

// -- trust refusal (exit code 3) ---------------------------------------------

/** Swap `vscode.window.showWarningMessage` for the test, answering with `answer`. */
function stubWarnings(t: ExecutionContext, answer: (message: string) => string | undefined) {
	const shown: {message: string; items: unknown[]}[] = [];
	const original = vscode.window.showWarningMessage;
	(vscode.window as any).showWarningMessage = async (message: string, ...items: unknown[]) => {
		shown.push({message, items});
		return answer(message);
	};
	t.teardown(() => {
		(vscode.window as any).showWarningMessage = original;
	});
	return shown;
}

function stubErrors(t: ExecutionContext) {
	const shown: string[] = [];
	const original = vscode.window.showErrorMessage;
	(vscode.window as any).showErrorMessage = async (message: string) => {
		shown.push(message);
		return undefined;
	};
	t.teardown(() => {
		(vscode.window as any).showErrorMessage = original;
	});
	return shown;
}

const notTrustedReport = JSON.stringify({
	path: '/work/project',
	status: 'not-trusted',
	summary: 'Runs 1 MCP server (.mcp.json).',
	fingerprint: 'abc123',
});

/** Let the prompt chain's queued promise callbacks run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

test('AcpProcessManager - exit code 3 stops retrying and asks for trust instead', async (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManager(stateManager);
	(manager as any).lastStderr = '[nanocoder] Directory /work/project is not trusted.\n';
	const warnings = stubWarnings(t, () => undefined);
	const errors = stubErrors(t);
	const cliCalls: string[][] = [];
	(manager as any).runTrustCli = async (args: string[]) => {
		cliCalls.push(args);
		return {code: 0, stdout: notTrustedReport, stderr: ''};
	};

	(manager as any).handleCrash(3);
	await settle();

	t.is(stateManager.status, ACPStatus.Untrusted);
	t.is((manager as any).retryTimer, null, 'no restart is scheduled');
	t.is((manager as any).retryCount, 0);
	t.deepEqual(cliCalls, [['trust', '--status', '--json']]);
	t.is(warnings.length, 1);
	t.regex(warnings[0].message, /\/work\/project is not a trusted folder/);
	t.deepEqual(warnings[0].items[0], {modal: true, detail: 'Runs 1 MCP server (.mcp.json).'});
	t.deepEqual(errors, [], 'no "crashed repeatedly" dialog');
	manager.dispose();
});

test('AcpProcessManager - Trust Folder grants the fingerprint shown and starts again', async (t) => {
	const manager = makeManager(new AcpStateManager());
	stubWarnings(t, () => 'Trust Folder');
	const cliCalls: string[][] = [];
	(manager as any).runTrustCli = async (args: string[]) => {
		cliCalls.push(args);
		return args[1] === '--status'
			? {code: 0, stdout: notTrustedReport, stderr: ''}
			: {code: 0, stdout: 'Trusted /work/project.', stderr: ''};
	};
	let starts = 0;
	manager.start = async () => {
		starts++;
	};

	(manager as any).handleCrash(3);
	await settle();

	t.deepEqual(cliCalls, [['trust', '--status', '--json'], ['trust', '--grant', 'abc123']]);
	t.is(starts, 1);
	manager.dispose();
});

test('AcpProcessManager - a failed grant is reported and does not restart', async (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManager(stateManager);
	stubWarnings(t, () => 'Trust Folder');
	const errors = stubErrors(t);
	(manager as any).runTrustCli = async (args: string[]) =>
		args[1] === '--status'
			? {code: 0, stdout: notTrustedReport, stderr: ''}
			: {code: 1, stdout: 'Not trusted: /work/project changed since that fingerprint was taken.', stderr: ''};
	let starts = 0;
	manager.start = async () => {
		starts++;
	};

	(manager as any).handleCrash(3);
	await settle();

	t.is(starts, 0);
	t.is(errors.length, 1);
	t.regex(errors[0], /changed since that fingerprint was taken/);
	t.is(stateManager.status, ACPStatus.Untrusted);
	manager.dispose();
});

test('AcpProcessManager - an unreadable trust status falls back to an actionable message', async (t) => {
	const manager = makeManager(new AcpStateManager());
	const warnings = stubWarnings(t, () => undefined);
	(manager as any).runTrustCli = async () => ({code: 1, stdout: '', stderr: 'unknown command'});

	(manager as any).handleCrash(3);
	await settle();

	t.is(warnings.length, 1);
	t.regex(warnings[0].message, /not trusted/);
	t.deepEqual(warnings[0].items, ['Manage Workspace Trust', 'Show Logs']);
	manager.dispose();
});

test('AcpProcessManager - other exit codes still retry as crashes', (t) => {
	const stateManager = new AcpStateManager();
	const manager = makeManager(stateManager);

	(manager as any).handleCrash(1);

	t.is(stateManager.status, ACPStatus.Restarting);
	t.is((manager as any).retryCount, 1);
	manager.dispose();
});

test.serial('AcpProcessManager - a real CLI that exits 3 is not retried, even though the handshake fails first', async (t) => {
	if (process.platform === 'win32') {
		t.pass('uses a POSIX shell script as the fake CLI');
		return;
	}
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-trust-'));
	t.teardown(() => rmSync(dir, {recursive: true, force: true}));
	const grantLog = join(dir, 'granted');
	const cli = join(dir, 'nanocoder');
	// Stands in for the real CLI: refuses --acp with exit 3, closing stdout
	// before it exits (so the handshake fails first), and answers the trust
	// subcommands.
	writeFileSync(
		cli,
		[
			'#!/bin/sh',
			'if [ "$1" = "--acp" ]; then',
			'  echo "[nanocoder] Directory is not trusted." >&2',
			'  exec 1>&-',
			'  sleep 0.2',
			'  exit 3',
			'fi',
			'if [ "$1" = "trust" ] && [ "$2" = "--status" ]; then',
			`  printf '%s' '${notTrustedReport}'`,
			'  exit 0',
			'fi',
			'if [ "$1" = "trust" ] && [ "$2" = "--grant" ]; then',
			`  printf '%s' "$3" > '${grantLog}'`,
			'  exit 0',
			'fi',
			'exit 1',
			'',
		].join('\n'),
		{mode: 0o755},
	);
	const vscodeStub = vscode as any;
	vscodeStub.__test.configuration = (section: string, key: string, fallback: unknown) =>
		section === 'nanocoder' && key === 'cliPath' ? cli : fallback;
	t.teardown(() => vscodeStub.__test.reset());

	stubWarnings(t, () => 'Trust Folder');
	const errors = stubErrors(t);

	const stateManager = new AcpStateManager();
	const outputChannel = {appendLine: () => {}, append: () => {}, show: () => {}} as any;
	const acpClient = {
		setConnection: () => {},
		// The stream closes before the exit is observed, so the handshake fails first.
		initializeHandshake: async () => false,
		dispose: () => {},
	} as any as NanocoderAcpClient;
	const manager = new AcpProcessManager(outputChannel, stateManager, acpClient);
	// Count every start after the first: a crash retry or the post-grant restart.
	let restarts = 0;
	const realStart = manager.start.bind(manager);
	manager.start = async () => {
		if ((manager as any).hasStarted) {
			restarts++;
			return;
		}
		return realStart();
	};
	t.teardown(() => manager.dispose());

	await manager.start();
	for (let i = 0; i < 300 && restarts === 0; i++) await settle();

	t.is(stateManager.status, ACPStatus.Untrusted);
	t.is((manager as any).retryCount, 0, 'the refusal was never counted as a crash');
	t.is(readFileSync(grantLog, 'utf8'), 'abc123');
	t.is(restarts, 1, 'starts once more, after trust is granted');
	t.deepEqual(errors, []);
});
