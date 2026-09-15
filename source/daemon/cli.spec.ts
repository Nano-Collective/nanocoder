import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'ava';
import type {ChildProcess} from 'node:child_process';
import {runDaemonCli} from './cli';
import {writeLockfile} from './lockfile';
import type {UserPreferences} from '@/types/index';

console.log(`\ncli.spec.ts`);

const TAIL_BYTES = 64 * 1024;

interface TrustHarness {
	stored: UserPreferences;
	saved: UserPreferences[];
	loadPreferences: () => UserPreferences;
	savePreferences: (preferences: UserPreferences) => void;
}

function makeTrustHarness(trustedDirectories: string[] = []): TrustHarness {
	const harness: TrustHarness = {
		stored: {trustedDirectories},
		saved: [],
		loadPreferences: () => ({...harness.stored}),
		savePreferences: preferences => {
			harness.saved.push(preferences);
			harness.stored = {...preferences};
		},
	};
	return harness;
}

function makeLockfileLauncher() {
	const calls: string[] = [];
	const launcher = (projectRoot: string): ChildProcess => {
		calls.push(projectRoot);
		// Satisfy waitForLockfile without spawning anything: a lockfile with
		// our own pid always reads as live.
		void writeLockfile({
			pid: process.pid,
			socketPath: 'test-socket',
			startedAt: Date.now(),
			projectRoot,
		});
		return {} as ChildProcess;
	};
	return {calls, launcher};
}

async function tempProject(logContent?: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'daemon-cli-'));
	await mkdir(join(root, '.nanocoder'), {recursive: true});
	if (logContent !== undefined) {
		await writeFile(join(root, '.nanocoder', 'daemon.log'), logContent, 'utf-8');
	}
	return root;
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

test.serial('start refuses to spawn when the project directory is not trusted', async t => {
	const root = await tempProject();
	const harness = makeTrustHarness();
	const {calls, launcher} = makeLockfileLauncher();
	const previousEnv = process.env.NANOCODER_TRUST_DIRECTORY;
	delete process.env.NANOCODER_TRUST_DIRECTORY;
	try {
		const result = await runDaemonCli('start', {
			projectRoot: root,
			launchDaemon: launcher,
			loadPreferences: harness.loadPreferences,
			savePreferences: harness.savePreferences,
		});
		t.is(result.exitCode, 1);
		t.regex(result.output, /not trusted/i);
		t.regex(result.output, /--trust-directory/);
		t.deepEqual(calls, [], 'daemon must not be spawned in an untrusted directory');
		t.is(harness.saved.length, 0);
	} finally {
		if (previousEnv === undefined) {
			delete process.env.NANOCODER_TRUST_DIRECTORY;
		} else {
			process.env.NANOCODER_TRUST_DIRECTORY = previousEnv;
		}
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('start proceeds when the directory is already trusted', async t => {
	const root = await tempProject();
	const harness = makeTrustHarness([resolve(root)]);
	const {calls, launcher} = makeLockfileLauncher();
	try {
		const result = await runDaemonCli('start', {
			projectRoot: root,
			launchDaemon: launcher,
			loadPreferences: harness.loadPreferences,
			savePreferences: harness.savePreferences,
		});
		t.is(result.exitCode, 0);
		t.regex(result.output, /Daemon started/);
		t.deepEqual(calls, [root]);
		t.is(harness.saved.length, 0, 'an already-trusted directory must not be rewritten');
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('start marks the directory trusted and proceeds when NANOCODER_TRUST_DIRECTORY=1', async t => {
	const root = await tempProject();
	const harness = makeTrustHarness();
	const {calls, launcher} = makeLockfileLauncher();
	const previousEnv = process.env.NANOCODER_TRUST_DIRECTORY;
	process.env.NANOCODER_TRUST_DIRECTORY = '1';
	try {
		const result = await runDaemonCli('start', {
			projectRoot: root,
			launchDaemon: launcher,
			loadPreferences: harness.loadPreferences,
			savePreferences: harness.savePreferences,
		});
		t.is(result.exitCode, 0);
		t.regex(result.output, /Daemon started/);
		t.deepEqual(calls, [root]);
		t.is(harness.saved.length, 1);
		t.deepEqual(harness.saved[0]?.trustedDirectories, [resolve(root)]);
	} finally {
		if (previousEnv === undefined) {
			delete process.env.NANOCODER_TRUST_DIRECTORY;
		} else {
			process.env.NANOCODER_TRUST_DIRECTORY = previousEnv;
		}
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('start records standing trust when --trust-directory is passed', async t => {
	const root = await tempProject();
	const harness = makeTrustHarness();
	const {calls, launcher} = makeLockfileLauncher();
	const previousEnv = process.env.NANOCODER_TRUST_DIRECTORY;
	delete process.env.NANOCODER_TRUST_DIRECTORY;
	try {
		const result = await runDaemonCli('start', {
			projectRoot: root,
			trustDirectory: true,
			launchDaemon: launcher,
			loadPreferences: harness.loadPreferences,
			savePreferences: harness.savePreferences,
		});
		t.is(result.exitCode, 0);
		t.regex(result.output, /Daemon started/);
		t.deepEqual(calls, [root]);
		t.is(harness.saved.length, 1);
		t.deepEqual(harness.saved[0]?.trustedDirectories, [resolve(root)]);
	} finally {
		if (previousEnv === undefined) {
			delete process.env.NANOCODER_TRUST_DIRECTORY;
		} else {
			process.env.NANOCODER_TRUST_DIRECTORY = previousEnv;
		}
		await rm(root, {recursive: true, force: true});
	}
});
