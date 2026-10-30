import {spawnSync} from 'node:child_process';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
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
	process.chdir(project);
	process.env.NANOCODER_CONFIG_DIR = configDir;
	resetPreferencesCache();
});

test.after.always(() => {
	process.chdir(tmpdir());
	delete process.env.NANOCODER_CONFIG_DIR;
	resetPreferencesCache();
	rmSync(configDir, {recursive: true, force: true});
	rmSync(project, {recursive: true, force: true});
});

const statusJson = () =>
	JSON.parse(runTrustCli(['--status', '--json']).output);

test.serial('--status --json reports an untrusted folder without running it', t => {
	const {fingerprint, summary} = describeProjectTrust(project);
	const result = runTrustCli(['--status', '--json']);
	t.is(result.exitCode, 0);
	t.like(JSON.parse(result.output), {
		status: 'not-trusted',
		fingerprint,
		summary,
	});
	t.regex(summary ?? '', /1 plugin/);
});

test.serial('--status prints text with the status and fingerprint', t => {
	const result = runTrustCli(['--status']);
	t.is(result.exitCode, 0);
	t.regex(result.output, /Status: not-trusted/);
	t.regex(
		result.output,
		new RegExp(`Fingerprint: ${describeProjectTrust(project).fingerprint}`),
	);
});

test.serial('--grant fails for a fingerprint that no longer matches', t => {
	const result = runTrustCli(['--grant', 'stale']);
	t.is(result.exitCode, 1);
	t.regex(result.output, /changed since that fingerprint/);
	t.is(statusJson().status, 'not-trusted');
	t.is(loadPreferences().trustedDirectories, undefined);
});

test.serial('--grant saves the folder, and a later edit reads as changed', t => {
	const {fingerprint} = describeProjectTrust(project);
	t.is(runTrustCli(['--grant', fingerprint]).exitCode, 0);
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

test("does not load the folder's .env into the environment", t => {
	const folder = mkdtempSync(join(tmpdir(), 'nanocoder-trust-cli-env-'));
	t.teardown(() => rmSync(folder, {recursive: true, force: true}));
	writeFileSync(join(folder, '.env'), 'TRUST_CLI_DOTENV_PROBE=loaded\n');

	// A fresh process, started in the folder, so importing the command is
	// the only thing that could read its .env.
	const module = import.meta.resolve('./trust-cli.ts');
	const script = `
		const {runTrustCli} = await import(${JSON.stringify(module)});
		const result = runTrustCli(['--status', '--json']);
		console.log(JSON.stringify({exitCode: result.exitCode, probe: process.env.TRUST_CLI_DOTENV_PROBE ?? null}));
	`;
	const run = spawnSync(
		process.execPath,
		['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', script],
		{
			encoding: 'utf8',
			cwd: folder,
			timeout: 60_000,
			env: {
				...process.env,
				NANOCODER_CONFIG_DIR: configDir,
				TSX_TSCONFIG_PATH: fileURLToPath(
					new URL('../../tsconfig.json', import.meta.url),
				),
			},
		},
	);
	t.is(run.status, 0, run.stderr);
	t.deepEqual(JSON.parse(run.stdout.trim()), {exitCode: 0, probe: null});
});

/**
 * Runs `script` in a fresh process started in `cwd`, with TypeScript sources
 * importable. A key set to `undefined` in `env` is removed from the environment
 * the process inherits.
 */
const runFresh = (
	script: string,
	cwd: string,
	env: NodeJS.ProcessEnv,
): ReturnType<typeof spawnSync> => {
	const merged: NodeJS.ProcessEnv = {
		...process.env,
		TSX_TSCONFIG_PATH: fileURLToPath(
			new URL('../../tsconfig.json', import.meta.url),
		),
		...env,
	};
	for (const key of Object.keys(merged)) {
		if (merged[key] === undefined) delete merged[key];
	}
	return spawnSync(
		process.execPath,
		['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', script],
		{encoding: 'utf8', cwd, timeout: 60_000, env: merged},
	);
};

test('importing the command does not load React, Ink or the message queue', t => {
	// The fast paths in cli.tsx exist to skip the app graph. A resolve hook in a
	// fresh process records every module the command's import pulls in.
	const module = import.meta.resolve('./trust-cli.ts');
	const hooks = `
		let port;
		export function initialize(data) { port = data.port; }
		export async function resolve(specifier, context, next) {
			const result = await next(specifier, context);
			port.postMessage(result.url);
			return result;
		}
	`;
	const script = `
		import {register} from 'node:module';
		import {MessageChannel} from 'node:worker_threads';
		const {port1, port2} = new MessageChannel();
		const urls = [];
		port1.on('message', url => urls.push(url));
		register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(hooks)}), {
			parentURL: import.meta.url,
			data: {port: port2},
			transferList: [port2],
		});
		await import(${JSON.stringify(module)});
		await new Promise(resolve => setTimeout(resolve, 500));
		const heavy = urls.filter(url =>
			/[\\\\/]node_modules[\\\\/](ink|react)[\\\\/]/.test(decodeURIComponent(url)) ||
			/message-queue/.test(url),
		);
		console.log(JSON.stringify({loaded: urls.length, heavy}));
		port1.close();
		process.exit(0);
	`;
	const run = runFresh(script, project, {NANOCODER_CONFIG_DIR: configDir});
	t.is(run.status, 0, String(run.stderr));
	const {loaded, heavy} = JSON.parse(String(run.stdout).trim());
	// The hook saw the command's own modules, so an empty list means "none heavy".
	t.true(loaded > 5, `only ${loaded} modules were seen`);
	t.deepEqual(heavy, []);
});

test('--grant writes only the global preferences file and leaves a read-only folder file alone', t => {
	const folder = mkdtempSync(join(tmpdir(), 'nanocoder-trust-cli-grant-'));
	const home = mkdtempSync(join(tmpdir(), 'nanocoder-trust-cli-home-'));
	const projectPrefs = join(folder, 'nanocoder-preferences.json');
	// Not how Nanocoder would write it, so a rewrite would show as a change.
	const original = '{"theme":"tokyo-night",   "trustedDirectories":["ignored-in-a-folder"]}';
	mkdirSync(join(folder, '.nanocoder', 'plugins'), {recursive: true});
	writeFileSync(join(folder, '.nanocoder', 'plugins', 'b.mjs'), 'export {};');
	writeFileSync(projectPrefs, original);
	chmodSync(projectPrefs, 0o444);
	t.teardown(() => {
		chmodSync(projectPrefs, 0o644);
		rmSync(folder, {recursive: true, force: true});
		rmSync(home, {recursive: true, force: true});
	});
	const before = statSync(projectPrefs).mtimeMs;

	// No NANOCODER_CONFIG_DIR, so the folder's preferences file is the one a
	// normal run would load; the config directory moves with the home variables.
	const env: NodeJS.ProcessEnv = {
		NANOCODER_CONFIG_DIR: undefined,
		HOME: home,
		USERPROFILE: home,
		XDG_CONFIG_HOME: home,
		APPDATA: home,
	};
	const script = `
		const {runTrustCli} = await import(${JSON.stringify(import.meta.resolve('./trust-cli.ts'))});
		const {getConfigPath} = await import(${JSON.stringify(import.meta.resolve('./paths.ts'))});
		const {mkdirSync, writeFileSync} = await import('node:fs');
		const {join} = await import('node:path');
		const configPath = getConfigPath();
		// A trust entry and a setting already in the global file must survive.
		mkdirSync(configPath, {recursive: true});
		writeFileSync(join(configPath, 'nanocoder-preferences.json'), JSON.stringify({
			theme: 'dracula',
			trustedDirectories: [{path: '/elsewhere', fingerprint: 'abc', fingerprintVersion: 1}],
		}));
		const status = JSON.parse(runTrustCli(['--status', '--json']).output);
		const grant = runTrustCli(['--grant', status.fingerprint]);
		const after = JSON.parse(runTrustCli(['--status', '--json']).output);
		console.log(JSON.stringify({before: status.status, path: status.path, grant, after: after.status, configPath}));
	`;
	const run = runFresh(script, folder, env);
	t.is(run.status, 0, String(run.stderr));
	const out = JSON.parse(String(run.stdout).trim());

	t.is(out.before, 'not-trusted');
	t.is(out.grant.exitCode, 0, out.grant.output);
	t.is(out.after, 'trusted');
	// The folder's file is exactly as it was: not rewritten, not reformatted.
	t.is(readFileSync(projectPrefs, 'utf8'), original);
	t.is(statSync(projectPrefs).mtimeMs, before);
	// The trust entry went to the global file, next to what was already there.
	const global = JSON.parse(
		readFileSync(join(out.configPath, 'nanocoder-preferences.json'), 'utf8'),
	);
	t.is(global.theme, 'dracula');
	t.deepEqual(
		global.trustedDirectories.map((entry: {path: string}) => entry.path).sort(),
		['/elsewhere', out.path].sort(),
	);
});

test('rejects unknown or incomplete arguments and prints usage for none', t => {
	for (const args of [
		['--grant'],
		['--status', '--grant'],
		['--bogus'],
		['--status', '--json', 'extra'],
		['--status', '--json', '--json'],
		['--grant', 'abc', '--json'],
	]) {
		const result = runTrustCli(args);
		t.is(result.exitCode, 1);
		t.regex(result.output, /Usage: nanocoder trust/);
	}
	t.is(
		JSON.parse(runTrustCli(['--json', '--status']).output).path,
		process.cwd(),
	);
	const help = runTrustCli([]);
	t.is(help.exitCode, 0);
	t.regex(help.output, /Usage: nanocoder trust/);
});
