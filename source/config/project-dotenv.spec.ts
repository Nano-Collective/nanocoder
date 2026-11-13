import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'ava';
import {
	ignoredDotenvWarning,
	isProtectedEnvKey,
	loadProjectDotenv,
} from './project-dotenv';

function withDotenv(content: string | null, fn: (dir: string) => void) {
	const dir = mkdtempSync(join(tmpdir(), 'project-dotenv-'));
	try {
		if (content !== null) writeFileSync(join(dir, '.env'), content);
		fn(dir);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
}

test('copies ordinary keys and leaves shell values alone', t => {
	withDotenv('API_KEY=from-file\nSHELL_SET=from-file\n', dir => {
		const env: NodeJS.ProcessEnv = {SHELL_SET: 'from-shell'};
		const result = loadProjectDotenv(dir, env);
		t.is(env.API_KEY, 'from-file');
		t.is(env.SHELL_SET, 'from-shell');
		t.deepEqual(result, {injected: ['API_KEY'], ignored: []});
	});
});

// Keys a cloned repo must not be able to set before the user trusts it.
const MUST_BE_PROTECTED = [
	// Trust, and where the trust record is read from and written to.
	'NANOCODER_TRUST_DIRECTORY',
	'NANOCODER_CONFIG_DIR',
	'XDG_CONFIG_HOME',
	'APPDATA',
	'NANOCODER_CI_TRUST_LEVEL',
	// Servers and providers started or contacted before trust.
	'NANOCODER_MCPSERVERS',
	'NANOCODER_MCPSERVERS_FILE',
	'NANOCODER_PROVIDERS',
	'NANOCODER_PROVIDERS_FILE',
	// Where sessions, logs and checkpoints are written.
	'NANOCODER_DATA_DIR',
	'NANOCODER_LOG_DIR',
	'NANOCODER_LOG_DISABLE_FILE',
	// A NANOCODER_* variable added later is protected by default.
	'NANOCODER_SOMETHING_NEW',
	// Code injected into every child process (MCP servers, hooks, bash, git).
	'NODE_OPTIONS',
	'BASH_ENV',
	'ENV',
	'LD_PRELOAD',
	'DYLD_INSERT_LIBRARIES',
	'PATH',
	'GIT_CONFIG_COUNT',
	'GIT_CONFIG_KEY_0',
	'GIT_CONFIG_VALUE_0',
	'GIT_CONFIG_GLOBAL',
	'GIT_SSH_COMMAND',
	'npm_config_script_shell',
	// Where traffic goes and whether TLS is checked.
	'HTTPS_PROXY',
	'https_proxy',
	'NODE_TLS_REJECT_UNAUTHORIZED',
];

test('a project .env cannot set trust, config, data, server or process-start variables', t => {
	const content = MUST_BE_PROTECTED.map(key => `${key}=1`).join('\n');
	withDotenv(`${content}\nOTHER=x\n`, dir => {
		const env: NodeJS.ProcessEnv = {};
		const result = loadProjectDotenv(dir, env);
		for (const key of MUST_BE_PROTECTED) {
			t.is(env[key], undefined, key);
			t.true(isProtectedEnvKey(key), key);
		}
		t.is(env.OTHER, 'x');
		t.deepEqual(result.ignored, MUST_BE_PROTECTED);
		t.deepEqual(result.injected, ['OTHER']);
	});
});

test('ordinary keys and the NANOCODER_* tuning allowlist still load', t => {
	const allowed = [
		'OPENROUTER_API_KEY',
		'DATABASE_URL',
		'NODE_ENV',
		'GITHUB_TOKEN',
		'MY_GIT_HOST',
		'NANOCODER_LOG_LEVEL',
		'NANOCODER_CONTEXT_LIMIT',
		'NANOCODER_MAX_TURNS',
		'NANOCODER_NO_UPDATE_CHECK',
	];
	withDotenv(allowed.map(key => `${key}=1`).join('\n'), dir => {
		const env: NodeJS.ProcessEnv = {};
		const result = loadProjectDotenv(dir, env);
		t.deepEqual(result.injected, allowed);
		t.deepEqual(result.ignored, []);
	});
});

test('protected keys from the real environment are kept', t => {
	withDotenv('NANOCODER_TRUST_DIRECTORY=0\n', dir => {
		const env: NodeJS.ProcessEnv = {NANOCODER_TRUST_DIRECTORY: '1'};
		const result = loadProjectDotenv(dir, env);
		t.is(env.NANOCODER_TRUST_DIRECTORY, '1');
		// The shell's value wins anyway, so nothing was dropped and the user
		// should not be warned about the .env.
		t.deepEqual(result.ignored, []);
	});
});

test('no .env is a no-op', t => {
	withDotenv(null, dir => {
		const env: NodeJS.ProcessEnv = {};
		t.deepEqual(loadProjectDotenv(dir, env), {injected: [], ignored: []});
		t.deepEqual(env, {});
	});
});

test('loading prints nothing to stdout', t => {
	withDotenv('QUIET_CHECK=1\n', dir => {
		const original = process.stdout.write.bind(process.stdout);
		let written = '';
		process.stdout.write = ((chunk: string | Uint8Array) => {
			written += String(chunk);
			return true;
		}) as typeof process.stdout.write;
		try {
			loadProjectDotenv(dir, {});
		} finally {
			process.stdout.write = original;
		}
		t.is(written, '');
	});
});

// Runs `script` in a fresh process whose cwd is `dir`, with the shell
// environment stripped of the keys under test.
function runInFolder(dir: string, script: string) {
	const env = {...process.env};
	delete env.DOTENV_PROBE_KEY;
	delete env.NANOCODER_TRUST_DIRECTORY;
	const configIndex = pathToFileURL(join(process.cwd(), 'source/config/index.ts')).href;
	const dotenvModule = pathToFileURL(join(process.cwd(), 'source/config/project-dotenv.ts')).href;
	return spawnSync(
		process.execPath,
		['--import', 'tsx', '--input-type=module', '--eval', script],
		{
			cwd: process.cwd(),
			encoding: 'utf-8',
			env: {
				...env,
				PROBE_DIR: dir,
				CONFIG_INDEX: configIndex,
				DOTENV_MODULE: dotenvModule,
			},
		},
	);
}

test('importing config no longer loads the project .env', t => {
	t.timeout(60_000);
	withDotenv('DOTENV_PROBE_KEY=from-file\n', dir => {
		const result = runInFolder(
			dir,
			`process.chdir(process.env.PROBE_DIR);
await import(process.env.CONFIG_INDEX);
process.stdout.write(String(process.env.DOTENV_PROBE_KEY));`,
		);
		t.is(result.stdout, 'undefined', result.stderr);
	});
});

test('bootstrapProjectDotenv loads the .env once and warns about protected keys', t => {
	t.timeout(60_000);
	withDotenv(
		'DOTENV_PROBE_KEY=from-file\nNANOCODER_TRUST_DIRECTORY=1\n',
		dir => {
			const result = runInFolder(
				dir,
				`const {bootstrapProjectDotenv} = await import(process.env.DOTENV_MODULE);
bootstrapProjectDotenv(process.env.PROBE_DIR);
delete process.env.DOTENV_PROBE_KEY;
bootstrapProjectDotenv(process.env.PROBE_DIR);
process.stdout.write(String(process.env.DOTENV_PROBE_KEY) + ' ' + String(process.env.NANOCODER_TRUST_DIRECTORY));`,
			);
			// The second call is a no-op, so the deleted key stays gone.
			t.is(result.stdout, 'undefined undefined', result.stderr);
			t.is(
				result.stderr.trim(),
				'Ignoring NANOCODER_TRUST_DIRECTORY from the project .env: set it in your shell environment instead.',
			);
		},
	);
});

test('bootstrapProjectDotenv injects ordinary keys from the folder', t => {
	t.timeout(60_000);
	withDotenv('DOTENV_PROBE_KEY=from-file\n', dir => {
		const result = runInFolder(
			dir,
			`const {bootstrapProjectDotenv} = await import(process.env.DOTENV_MODULE);
process.chdir(process.env.PROBE_DIR);
bootstrapProjectDotenv();
process.stdout.write(String(process.env.DOTENV_PROBE_KEY));`,
		);
		t.is(result.stdout, 'from-file', result.stderr);
	});
});

test('warning names the ignored keys', t => {
	t.is(ignoredDotenvWarning([]), null);
	t.is(
		ignoredDotenvWarning(['NANOCODER_TRUST_DIRECTORY']),
		'Ignoring NANOCODER_TRUST_DIRECTORY from the project .env: set it in your shell environment instead.',
	);
});
