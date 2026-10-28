import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {loadPreferences, resetPreferencesCache} from '@/config/preferences';
import {describeProjectTrust} from '@/config/project-trust';
import {runTrustCli} from '@/config/trust-cli';

console.log('\ntrust-cli.spec.ts');

const configDir = mkdtempSync(join(tmpdir(), 'nanocoder-trust-cli-config-'));
const project = mkdtempSync(join(tmpdir(), 'nanocoder-trust-cli-project-'));
mkdirSync(join(project, '.nanocoder', 'plugins'), {recursive: true});
writeFileSync(join(project, '.nanocoder', 'plugins', 'a.mjs'), 'export {};');

test.before(() => {
	process.env.NANOCODER_CONFIG_DIR = configDir;
	resetPreferencesCache();
});

test.after.always(() => {
	delete process.env.NANOCODER_CONFIG_DIR;
	resetPreferencesCache();
	rmSync(configDir, {recursive: true, force: true});
	rmSync(project, {recursive: true, force: true});
});

const statusJson = () =>
	JSON.parse(runTrustCli(['--status', '--json'], {cwd: project}).output);

test.serial('--status --json reports an untrusted folder without running it', t => {
	const {fingerprint, summary} = describeProjectTrust(project);
	const result = runTrustCli(['--status', '--json'], {cwd: project});
	t.is(result.exitCode, 0);
	t.like(JSON.parse(result.output), {
		status: 'not-trusted',
		fingerprint,
		summary,
	});
	t.regex(summary ?? '', /1 plugin/);
});

test.serial('--status prints text with the status and fingerprint', t => {
	const result = runTrustCli(['--status'], {cwd: project});
	t.is(result.exitCode, 0);
	t.regex(result.output, /Status: not-trusted/);
	t.regex(
		result.output,
		new RegExp(`Fingerprint: ${describeProjectTrust(project).fingerprint}`),
	);
});

test.serial('--grant fails for a fingerprint that no longer matches', t => {
	const result = runTrustCli(['--grant', 'stale'], {cwd: project});
	t.is(result.exitCode, 1);
	t.regex(result.output, /changed since that fingerprint/);
	t.is(statusJson().status, 'not-trusted');
	t.is(loadPreferences().trustedDirectories, undefined);
});

test.serial('--grant saves the folder, and a later edit reads as changed', t => {
	const {fingerprint} = describeProjectTrust(project);
	t.is(runTrustCli(['--grant', fingerprint], {cwd: project}).exitCode, 0);
	t.is(statusJson().status, 'trusted');

	writeFileSync(join(project, '.nanocoder', 'plugins', 'b.mjs'), 'export {};');
	t.is(statusJson().status, 'changed');
});

test.serial('a record from another fingerprint version needs re-approval', t => {
	writeFileSync(
		join(configDir, 'nanocoder-preferences.json'),
		JSON.stringify({
			trustedDirectories: [
				{
					path: project,
					fingerprint: describeProjectTrust(project).fingerprint,
					fingerprintVersion: 999,
				},
			],
		}),
	);
	resetPreferencesCache();
	t.is(statusJson().status, 'needs-re-approval');
});

test('rejects unknown or incomplete arguments and prints usage for none', t => {
	for (const args of [['--grant'], ['--status', '--grant'], ['--bogus']]) {
		const result = runTrustCli(args, {cwd: project});
		t.is(result.exitCode, 1);
		t.regex(result.output, /Usage: nanocoder trust/);
	}
	const help = runTrustCli([], {cwd: project});
	t.is(help.exitCode, 0);
	t.regex(help.output, /Usage: nanocoder trust/);
});
