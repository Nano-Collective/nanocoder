import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	ignoredDotenvWarning,
	loadProjectDotenv,
	PROTECTED_ENV_KEYS,
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

test('a project .env cannot set trust, config dir, or MCP variables', t => {
	const content = PROTECTED_ENV_KEYS.map(key => `${key}=1`).join('\n');
	withDotenv(`${content}\nOTHER=x\n`, dir => {
		const env: NodeJS.ProcessEnv = {};
		const result = loadProjectDotenv(dir, env);
		for (const key of PROTECTED_ENV_KEYS) {
			t.is(env[key], undefined, key);
		}
		t.is(env.OTHER, 'x');
		t.deepEqual(result.ignored, [...PROTECTED_ENV_KEYS]);
		t.true(PROTECTED_ENV_KEYS.includes('NANOCODER_TRUST_DIRECTORY'));
	});
});

test('protected keys from the real environment are kept', t => {
	withDotenv('NANOCODER_TRUST_DIRECTORY=0\n', dir => {
		const env: NodeJS.ProcessEnv = {NANOCODER_TRUST_DIRECTORY: '1'};
		loadProjectDotenv(dir, env);
		t.is(env.NANOCODER_TRUST_DIRECTORY, '1');
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

test('warning names the ignored keys', t => {
	t.is(ignoredDotenvWarning([]), null);
	t.is(
		ignoredDotenvWarning(['NANOCODER_TRUST_DIRECTORY']),
		'Ignoring NANOCODER_TRUST_DIRECTORY from the project .env: set it in your shell environment instead.',
	);
});
