import type {ChildProcess} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	loadPreferences,
	resetPreferencesCache,
	savePreferences,
} from '@/config/preferences';
import {runDaemonCli} from './cli';
import {writeLockfile} from './lockfile';

console.log(`\ncli.spec.ts`);

const TAIL_BYTES = 64 * 1024;

async function tempProject(logContent?: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'daemon-cli-'));
	await mkdir(join(root, '.nanocoder'), {recursive: true});
	if (logContent !== undefined) {
		await writeFile(join(root, '.nanocoder', 'daemon.log'), logContent, 'utf-8');
	}
	return root;
}

/**
 * `start`'s directory-trust gate reads/writes preferences through the real
 * `@/config/preferences` module (there's no deps-injection seam for it, unlike
 * `launchDaemon`), so these tests point `NANOCODER_CONFIG_DIR` at a scratch
 * directory rather than touching whatever preferences file the machine
 * running the suite already has.
 */
async function withIsolatedPreferences<T>(fn: () => Promise<T>): Promise<T> {
	const configDir = await mkdtemp(join(tmpdir(), 'daemon-cli-prefs-'));
	const previous = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = configDir;
	resetPreferencesCache();
	try {
		return await fn();
	} finally {
		if (previous === undefined) delete process.env.NANOCODER_CONFIG_DIR;
		else process.env.NANOCODER_CONFIG_DIR = previous;
		resetPreferencesCache();
		await rm(configDir, {recursive: true, force: true});
	}
}

/**
 * Stub launcher matching the real daemon's behavior just enough for
 * `start`'s `waitForLockfile` poll to succeed: it writes a lockfile pointing
 * at this test process's own pid, which `isProcessAlive` will find alive.
 */
function stubLaunchDaemon(projectRoot: string): ChildProcess {
	void writeLockfile({
		pid: process.pid,
		socketPath: 'fake-socket-for-test',
		startedAt: Date.now(),
		projectRoot,
	});
	return {} as unknown as ChildProcess;
}

test.serial('logs reports when no daemon log exists', async t => {
	const root = await tempProject();
	try {
		const result = await runDaemonCli('logs', {projectRoot: root});
		t.is(result.exitCode, 0);
		t.is(result.output, 'No daemon log yet.');
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('logs returns the whole log when it is smaller than the tail window', async t => {
	const content = 'first line\nsecond line\n';
	const root = await tempProject(content);
	try {
		const result = await runDaemonCli('logs', {projectRoot: root});
		t.is(result.exitCode, 0);
		t.is(result.output, content);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('logs returns only the tail of a large log', async t => {
	const line = `${'x'.repeat(99)}\n`;
	const lines = Math.ceil((TAIL_BYTES * 3) / line.length);
	const content = `${Array.from({length: lines}, (_, i) => `${i} ${line}`).join('')}last line\n`;
	const root = await tempProject(content);
	try {
		const result = await runDaemonCli('logs', {projectRoot: root});
		t.is(result.exitCode, 0);
		t.true(result.output.endsWith('last line\n'));
		const bytes = Buffer.byteLength(result.output, 'utf-8');
		t.true(bytes <= TAIL_BYTES);
		t.true(bytes > TAIL_BYTES / 2);
		t.true(result.output.length < content.length);
		t.false(result.output.startsWith('0 '));
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('logs keeps the tail intact when the log holds multi-byte characters', async t => {
	const line = `${'é'.repeat(60)}\n`;
	const lines = Math.ceil((TAIL_BYTES * 2) / Buffer.byteLength(line, 'utf-8'));
	const content = `${Array.from({length: lines}, () => line).join('')}last line\n`;
	const root = await tempProject(content);
	try {
		const result = await runDaemonCli('logs', {projectRoot: root});
		t.is(result.exitCode, 0);
		t.true(result.output.endsWith('last line\n'));
		t.false(result.output.includes('�'));
		const bytes = Buffer.byteLength(result.output, 'utf-8');
		t.true(bytes <= TAIL_BYTES);
		// A byte offset applied to a decoded string would cut far past the window.
		t.true(bytes > TAIL_BYTES / 2);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('logs keeps the tail when the window holds no line break', async t => {
	const content = `${'é'.repeat(100_000)}\n`;
	const root = await tempProject(content);
	try {
		const result = await runDaemonCli('logs', {projectRoot: root});
		t.is(result.exitCode, 0);
		t.not(result.output, '');
		const bytes = Buffer.byteLength(result.output, 'utf-8');
		t.true(bytes > TAIL_BYTES / 2);
		t.true(bytes <= TAIL_BYTES);
		t.false(result.output.includes('�'));
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('logs keeps the tail when the first line break sits late in the window', async t => {
	// One oversized log line runs past the start of the window, so the first
	// line break is thousands of bytes in. Realigning to it would return only
	// the handful of bytes that follow.
	const content = `${'a'.repeat(200_000)}${'x'.repeat(60_000)}\ntail line\n`;
	const root = await tempProject(content);
	try {
		const result = await runDaemonCli('logs', {projectRoot: root});
		t.is(result.exitCode, 0);
		t.true(result.output.endsWith('tail line\n'));
		const bytes = Buffer.byteLength(result.output, 'utf-8');
		t.true(bytes > TAIL_BYTES / 2);
		t.true(bytes <= TAIL_BYTES);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('logs keeps every line when the window opens on a line boundary', async t => {
	const line = `${'z'.repeat(63)}\n`;
	const content = line.repeat(2000);
	const root = await tempProject(content);
	try {
		const result = await runDaemonCli('logs', {projectRoot: root});
		t.is(result.exitCode, 0);
		t.is(result.output.split('\n').filter(Boolean).length, TAIL_BYTES / 64);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('logs starts the tail on a line boundary', async t => {
	const line = `${'y'.repeat(120)}\n`;
	const lines = Math.ceil((TAIL_BYTES * 2) / line.length);
	const content = Array.from({length: lines}, () => line).join('');
	const root = await tempProject(content);
	try {
		const result = await runDaemonCli('logs', {projectRoot: root});
		t.is(result.exitCode, 0);
		const entries = result.output.split('\n').filter(Boolean);
		t.true(entries.length > TAIL_BYTES / 121 / 2);
		for (const entry of entries) {
			t.is(entry.length, 120);
		}
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

// ============================================================================
// start: directory-trust gate. The daemon loads and executes skills
// unattended (headless mode, no confirmation prompts), so it must refuse to
// boot in a directory the user hasn't trusted.
// ============================================================================

test.serial(
	'start refuses to boot in an untrusted directory and never spawns the launcher',
	async t => {
		const root = await tempProject();
		try {
			await withIsolatedPreferences(async () => {
				let launched = false;
				const result = await runDaemonCli('start', {
					projectRoot: root,
					launchDaemon: () => {
						launched = true;
						return stubLaunchDaemon(root);
					},
				});
				t.is(result.exitCode, 1);
				t.regex(result.output, /not trusted/i);
				t.false(launched, 'an untrusted directory must never spawn the daemon');
			});
		} finally {
			await rm(root, {recursive: true, force: true});
		}
	},
);

test.serial(
	'start boots normally when the directory is already trusted',
	async t => {
		const root = await tempProject();
		try {
			await withIsolatedPreferences(async () => {
				savePreferences({trustedDirectories: [root]});
				let launched = false;
				const result = await runDaemonCli('start', {
					projectRoot: root,
					launchDaemon: projectRoot => {
						launched = true;
						return stubLaunchDaemon(projectRoot);
					},
				});
				t.true(launched);
				t.is(result.exitCode, 0);
				t.regex(result.output, /Daemon started/);
			});
		} finally {
			await rm(root, {recursive: true, force: true});
		}
	},
);

test.serial(
	'start --trust-directory bypasses the check without persisting trust',
	async t => {
		const root = await tempProject();
		try {
			await withIsolatedPreferences(async () => {
				let launched = false;
				const result = await runDaemonCli('start', {
					projectRoot: root,
					trustDirectory: true,
					launchDaemon: projectRoot => {
						launched = true;
						return stubLaunchDaemon(projectRoot);
					},
				});
				t.true(launched);
				t.is(result.exitCode, 0);
				t.false(
					(loadPreferences().trustedDirectories ?? []).includes(root),
					'--trust-directory is a one-shot bypass and must not persist',
				);
			});
		} finally {
			await rm(root, {recursive: true, force: true});
		}
	},
);

test.serial(
	'start with NANOCODER_TRUST_DIRECTORY=1 trusts and persists, then boots',
	async t => {
		const root = await tempProject();
		process.env.NANOCODER_TRUST_DIRECTORY = '1';
		try {
			await withIsolatedPreferences(async () => {
				let launched = false;
				const result = await runDaemonCli('start', {
					projectRoot: root,
					launchDaemon: projectRoot => {
						launched = true;
						return stubLaunchDaemon(projectRoot);
					},
				});
				t.true(launched);
				t.is(result.exitCode, 0);
				t.true(
					(loadPreferences().trustedDirectories ?? []).includes(root),
				);
			});
		} finally {
			delete process.env.NANOCODER_TRUST_DIRECTORY;
			await rm(root, {recursive: true, force: true});
		}
	},
);
