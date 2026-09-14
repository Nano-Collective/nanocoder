import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {runDaemonCli} from './cli';
import {getSocketPath, removeLockfile, writeLockfile} from './lockfile';

console.log('\ncli.spec.ts');

async function tempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'daemon-cli-'));
	await mkdir(join(root, '.nanocoder'), {recursive: true});
	return root;
}

/** A launchDaemon stub that simulates a successful boot by writing a real,
 * live lockfile (pid = this test process's own pid, so isProcessAlive sees
 * it as live) — lets `start()`'s real waitForLockfile polling succeed
 * quickly without spawning an actual child process. */
function successfulLaunchDaemon(projectRoot: string) {
	const calls: Array<{projectRoot: string; trustLevel: string}> = [];
	return {
		launch: (root: string, trustLevel: import('@/verify/trust').TrustLevel) => {
			calls.push({projectRoot: root, trustLevel});
			void writeLockfile({
				pid: process.pid,
				socketPath: getSocketPath(projectRoot),
				startedAt: Date.now(),
				projectRoot,
			});
			return {} as import('node:child_process').ChildProcess;
		},
		calls,
	};
}

test.serial('unknown flag is rejected with exit 1 and no daemon spawned', async t => {
	const root = await tempProject();
	const launcher = successfulLaunchDaemon(root);
	try {
		const result = await runDaemonCli('start', {
			projectRoot: root,
			args: ['--bogus'],
			launchDaemon: launcher.launch,
		});
		t.is(result.exitCode, 1);
		t.regex(result.output, /Unknown flag/);
		t.is(launcher.calls.length, 0);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('invalid --trust value is rejected with exit 1', async t => {
	const root = await tempProject();
	const launcher = successfulLaunchDaemon(root);
	try {
		const result = await runDaemonCli('start', {
			projectRoot: root,
			args: ['--trust', 'yolo'],
			launchDaemon: launcher.launch,
		});
		t.is(result.exitCode, 1);
		t.regex(result.output, /Invalid --trust value/);
		t.is(launcher.calls.length, 0);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('--trust flag takes precedence over the project config value', async t => {
	const root = await tempProject();
	const launcher = successfulLaunchDaemon(root);
	try {
		const result = await runDaemonCli('start', {
			projectRoot: root,
			args: ['--trust', 'auto-fix'],
			launchDaemon: launcher.launch,
			loadVerifyConfigFn: () => ({trustLevel: 'comment-only'}),
		});
		t.is(result.exitCode, 0);
		t.is(launcher.calls[0]?.trustLevel, 'auto-fix');
	} finally {
		await rm(root, {recursive: true, force: true});
		await removeLockfile(root);
	}
});

test.serial('project config trust level is used when no flag is given', async t => {
	const root = await tempProject();
	const launcher = successfulLaunchDaemon(root);
	try {
		const result = await runDaemonCli('start', {
			projectRoot: root,
			args: [],
			launchDaemon: launcher.launch,
			loadVerifyConfigFn: () => ({trustLevel: 'auto-fix'}),
		});
		t.is(result.exitCode, 0);
		t.is(launcher.calls[0]?.trustLevel, 'auto-fix');
	} finally {
		await rm(root, {recursive: true, force: true});
		await removeLockfile(root);
	}
});

test.serial('defaults to comment-only when neither flag nor config is given', async t => {
	const root = await tempProject();
	const launcher = successfulLaunchDaemon(root);
	try {
		const result = await runDaemonCli('start', {
			projectRoot: root,
			args: [],
			launchDaemon: launcher.launch,
			loadVerifyConfigFn: () => undefined,
		});
		t.is(result.exitCode, 0);
		t.is(launcher.calls[0]?.trustLevel, 'comment-only');
	} finally {
		await rm(root, {recursive: true, force: true});
		await removeLockfile(root);
	}
});

test.serial('full-commit: declining the confirmation aborts without spawning the daemon', async t => {
	const root = await tempProject();
	const launcher = successfulLaunchDaemon(root);
	try {
		const result = await runDaemonCli('start', {
			projectRoot: root,
			args: ['--trust', 'full-commit'],
			launchDaemon: launcher.launch,
			isFullCommitTrustConfirmedFn: () => false,
			confirmFullCommitTrust: async () => false,
		});
		t.is(result.exitCode, 1);
		t.regex(result.output, /not confirmed/);
		t.is(launcher.calls.length, 0);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('full-commit: accepting the confirmation records it and spawns the daemon', async t => {
	const root = await tempProject();
	const launcher = successfulLaunchDaemon(root);
	let recorded: string | undefined;
	try {
		const result = await runDaemonCli('start', {
			projectRoot: root,
			args: ['--trust', 'full-commit'],
			launchDaemon: launcher.launch,
			isFullCommitTrustConfirmedFn: () => false,
			confirmFullCommitTrust: async () => true,
			recordFullCommitTrustConfirmedFn: p => {
				recorded = p;
			},
		});
		t.is(result.exitCode, 0);
		t.is(launcher.calls[0]?.trustLevel, 'full-commit');
		t.is(recorded, root);
	} finally {
		await rm(root, {recursive: true, force: true});
		await removeLockfile(root);
	}
});

test.serial('full-commit: already-confirmed projects skip the prompt entirely', async t => {
	const root = await tempProject();
	const launcher = successfulLaunchDaemon(root);
	let promptCalled = false;
	try {
		const result = await runDaemonCli('start', {
			projectRoot: root,
			args: ['--trust', 'full-commit'],
			launchDaemon: launcher.launch,
			isFullCommitTrustConfirmedFn: () => true,
			confirmFullCommitTrust: async () => {
				promptCalled = true;
				return true;
			},
		});
		t.is(result.exitCode, 0);
		t.false(promptCalled, 'the prompt must not run when already confirmed');
		t.is(launcher.calls[0]?.trustLevel, 'full-commit');
	} finally {
		await rm(root, {recursive: true, force: true});
		await removeLockfile(root);
	}
});
