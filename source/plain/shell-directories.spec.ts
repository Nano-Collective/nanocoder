import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	describeProjectTrust,
	TRUST_FINGERPRINT_VERSION,
} from '@/config/trust/project-trust';
import {resetSessionCwd} from '@/services/session-cwd';
import {
	getWorkingDirectories,
	setCliDirectories,
} from '@/services/working-directories';
import {runPlainShell, type RunPlainShellDeps} from './shell';

test.serial(
	'plain startup refuses an untrusted addition before initializing tools',
	async t => {
		const extra = mkdtempSync(join(tmpdir(), 'nano-plain-extra-'));
		const original = process.stdout.write;
		const trustEnv = process.env.NANOCODER_TRUST_DIRECTORY;
		delete process.env.NANOCODER_TRUST_DIRECTORY;
		let output = '';
		process.stdout.write = ((chunk: string | Uint8Array) => {
			output += String(chunk);
			return true;
		}) as typeof process.stdout.write;
		setCliDirectories([{path: extra}]);
		let initialized = false;
		let exitCode: number | undefined;
		t.teardown(() => {
			process.stdout.write = original;
			if (trustEnv !== undefined)
				process.env.NANOCODER_TRUST_DIRECTORY = trustEnv;
			resetSessionCwd();
			rmSync(extra, {recursive: true, force: true});
		});
		await runPlainShell({
			prompt: 'inspect files',
			developmentMode: 'auto-accept',
			trustDirectory: false,
			outputFormat: 'json',
			deps: {
				loadPreferences: () => ({
					trustedDirectories: [
						{
							path: process.cwd(),
							fingerprint: describeProjectTrust(process.cwd()).fingerprint,
							fingerprintVersion: TRUST_FINGERPRINT_VERSION,
						},
					],
				}),
				initializePlain: async () => {
					initialized = true;
					throw new Error('must not initialize');
				},
				getShutdownManager: () => ({
					gracefulShutdown: async (code: number) => {
						exitCode = code;
					},
				}),
			} as unknown as Partial<RunPlainShellDeps>,
		});
		t.false(initialized);
		t.is(exitCode, 1);
		t.is(getWorkingDirectories().length, 1);
		t.true(output.includes(extra));
		t.true(output.includes('not trusted'));
	},
);
