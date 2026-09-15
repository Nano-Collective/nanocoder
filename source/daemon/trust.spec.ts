import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'ava';
import type {UserPreferences} from '@/types/index';
import {
	checkDaemonBootTrust,
	ensureDirectoryTrust,
	hasTrustDirectoryFlag,
} from './trust';

console.log(`\ntrust.spec.ts`);

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

async function tempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'daemon-trust-'));
	await mkdir(join(root, '.nanocoder'), {recursive: true});
	return root;
}

function withoutTrustEnv(run: () => void | Promise<void>): Promise<void> {
	const previousEnv = process.env.NANOCODER_TRUST_DIRECTORY;
	delete process.env.NANOCODER_TRUST_DIRECTORY;
	return Promise.resolve()
		.then(run)
		.finally(() => {
			if (previousEnv === undefined) {
				delete process.env.NANOCODER_TRUST_DIRECTORY;
			} else {
				process.env.NANOCODER_TRUST_DIRECTORY = previousEnv;
			}
		});
}

test.serial('hasTrustDirectoryFlag reads the flag after the subcommand', t => {
	t.true(hasTrustDirectoryFlag(['daemon', 'start', '--trust-directory']));
});

test.serial('hasTrustDirectoryFlag reads the flag before the subcommand', t => {
	// The daemon fast path in `cli.tsx` short-circuits before the general
	// parser, so it cannot only look at the args after `daemon <sub>`: the
	// general parser accepts the flag in either position.
	t.true(hasTrustDirectoryFlag(['--trust-directory', 'daemon', 'start']));
});

test.serial('hasTrustDirectoryFlag ignores everything else', t => {
	t.false(hasTrustDirectoryFlag([]));
	t.false(hasTrustDirectoryFlag(['daemon', 'start']));
	t.false(hasTrustDirectoryFlag(['daemon', 'start', '--no-trust-directory']));
	t.false(hasTrustDirectoryFlag(['run', '--trust']));
});

test.serial('ensureDirectoryTrust records standing trust for the daemon when the flag is passed', t => {
	// Intentional divergence from the plain shell, where the same flag only
	// skips the prompt for that run: the daemon survives the spawn and can be
	// booted again by autostart, so the trust has to outlive the CLI process.
	const harness = makeTrustHarness();
	return withoutTrustEnv(() => {
		const result = ensureDirectoryTrust('/tmp/daemon-flag-trust', true, harness);
		t.true(result.trusted);
		t.true(result.markedTrusted);
		t.deepEqual(harness.saved[0]?.trustedDirectories, [
			resolve('/tmp/daemon-flag-trust'),
		]);
	});
});

test.serial('ensureDirectoryTrust does not rewrite an already-trusted directory', t => {
	const root = resolve('/tmp/daemon-already-trusted');
	const harness = makeTrustHarness([root]);
	return withoutTrustEnv(() => {
		const result = ensureDirectoryTrust(root, false, harness);
		t.true(result.trusted);
		t.false(result.markedTrusted);
		t.is(harness.saved.length, 0);
	});
});

test.serial('checkDaemonBootTrust refuses an untrusted directory and explains why', async t => {
	const root = await tempProject();
	const harness = makeTrustHarness();
	try {
		await withoutTrustEnv(() => {
			const gate = checkDaemonBootTrust(root, harness);
			t.false(gate.trusted);
			t.regex(gate.message, /not trusted/i);
			t.true(gate.message.includes(resolve(root)));
			t.regex(gate.message, /NANOCODER_TRUST_DIRECTORY=1/);
		});
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('checkDaemonBootTrust passes a directory trusted by an earlier run', async t => {
	const root = await tempProject();
	const harness = makeTrustHarness([resolve(root)]);
	try {
		await withoutTrustEnv(() => {
			const gate = checkDaemonBootTrust(root, harness);
			t.true(gate.trusted);
			t.is(gate.message, '');
		});
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('checkDaemonBootTrust passes and persists NANOCODER_TRUST_DIRECTORY=1', async t => {
	const root = await tempProject();
	const harness = makeTrustHarness();
	const previousEnv = process.env.NANOCODER_TRUST_DIRECTORY;
	process.env.NANOCODER_TRUST_DIRECTORY = '1';
	try {
		const gate = checkDaemonBootTrust(root, harness);
		t.true(gate.trusted);
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

test.serial('checkDaemonBootTrust never trusts the boot off the invoking argv', async t => {
	// Autostart boots carry no argv at all, so the gate must not treat the
	// presence of `--trust-directory` in some argv as trust for the boot.
	const root = await tempProject();
	const harness = makeTrustHarness();
	const originalArgv = process.argv;
	process.argv = [...originalArgv, '--trust-directory'];
	try {
		await withoutTrustEnv(() => {
			const gate = checkDaemonBootTrust(root, harness);
			t.false(gate.trusted);
		});
	} finally {
		process.argv = originalArgv;
		await rm(root, {recursive: true, force: true});
	}
});
