import {spawnSync} from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'ava';

const cliPath = fileURLToPath(new URL('./cli.tsx', import.meta.url));

const USAGE_ERROR = '`nanocoder run` needs a prompt';
// With an empty config dir the run gets as far as looking for a provider and
// stops there. Reaching that message means the prompt was accepted, which is
// what these tests need to know without calling a model.
const PAST_PROMPT_CHECK = 'No providers configured';

// `input` is what gets piped to stdin; undefined closes stdin empty, like
// CI with stdin on /dev/null.
function runCli(args: string[], input?: string) {
	const configDir = mkdtempSync(join(tmpdir(), 'nanocoder-stdin-'));
	try {
		return spawnSync(
			process.execPath,
			['--import=tsx', cliPath, '--trust-directory', ...args],
			{
				encoding: 'utf8',
				timeout: 30_000,
				input: input ?? '',
				env: {
					...process.env,
					NANOCODER_CONFIG_DIR: configDir,
					NODE_DISABLE_COMPILE_CACHE: '1',
					TSX_DISABLE_CACHE: '1',
				},
			},
		);
	} finally {
		rmSync(configDir, {recursive: true, force: true});
	}
}

test('run with no prompt and nothing piped is still a usage error', t => {
	const result = runCli(['run']);
	t.is(result.status, 1, result.stderr);
	t.true(result.stderr.includes(USAGE_ERROR), result.stderr);
	// The message now tells people about the pipe.
	t.true(result.stderr.includes('pipe one in'), result.stderr);
});

test('run with whitespace-only stdin and no prompt is still a usage error', t => {
	const result = runCli(['run'], ' \n\n');
	t.is(result.status, 1, result.stderr);
	t.true(result.stderr.includes(USAGE_ERROR), result.stderr);
});

test('piped stdin alone is accepted as the prompt', t => {
	const result = runCli(['run'], 'why did this fail\n');
	t.false(result.stderr.includes(USAGE_ERROR), result.stderr);
	t.true(result.stderr.includes(PAST_PROMPT_CHECK), result.stderr);
});

test('piped stdin alongside a positional prompt is accepted', t => {
	const result = runCli(['run', 'write a commit message'], 'diff --git a b\n');
	t.false(result.stderr.includes(USAGE_ERROR), result.stderr);
	t.true(result.stderr.includes(PAST_PROMPT_CHECK), result.stderr);
});

test('--prompt-file - reads the prompt from stdin', t => {
	const result = runCli(['run', '--prompt-file', '-'], 'summarize this\n');
	t.false(result.stderr.includes(USAGE_ERROR), result.stderr);
	t.false(result.stderr.includes('Could not read'), result.stderr);
	t.true(result.stderr.includes(PAST_PROMPT_CHECK), result.stderr);
});

test('--prompt-file - with an empty pipe has no prompt to run', t => {
	const result = runCli(['run', '--prompt-file', '-']);
	t.is(result.status, 1, result.stderr);
	t.true(result.stderr.includes(USAGE_ERROR), result.stderr);
});

test('--prompt-file <file> still takes stdin as extra input', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-stdin-file-'));
	try {
		const file = join(dir, 'prompt.txt');
		writeFileSync(file, 'summarize the log');
		const result = runCli(['run', '--prompt-file', file], 'ERROR: boom\n');
		t.false(result.stderr.includes(USAGE_ERROR), result.stderr);
		t.true(result.stderr.includes(PAST_PROMPT_CHECK), result.stderr);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('an oversized pipe is read without failing the run', t => {
	// Well past MAX_STDIN_PROMPT_BYTES. Stopping early closes the pipe on the
	// writer, which must not turn into a crash here.
	const result = runCli(['run', 'summarize'], 'z'.repeat(500_000));
	t.false(result.stderr.includes(USAGE_ERROR), result.stderr);
	t.false(result.stderr.includes('Could not read stdin'), result.stderr);
	t.true(result.stderr.includes(PAST_PROMPT_CHECK), result.stderr);
});

test('--help documents piping and --prompt-file -', t => {
	const result = runCli(['--help']);
	t.is(result.status, 0, result.stderr);
	t.true(result.stdout.includes('Use "-" to read the prompt from stdin'));
	t.true(result.stdout.includes('git diff | nanocoder run'));
});

// The prompt that actually reaches the model, captured through a
// user-prompt-submit hook. Everything above tests the pieces; this tests that
// the piped text, the wrapper and the cut note survive the whole run.
const isWindows = process.platform === 'win32';

(isWindows ? test.skip : test)(
	'the prompt the model receives carries the stdin block and the cut note',
	t => {
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-stdin-e2e-'));
		try {
			const configDir = join(dir, 'cfg');
			mkdirSync(configDir);
			const capture = join(dir, 'captured.txt');
			writeFileSync(
				join(configDir, 'agents.config.json'),
				JSON.stringify({
					nanocoder: {
						hooks: {
							'user-prompt-submit': [
								{command: `printf '%s' "$NANOCODER_PROMPT" > ${capture}`},
							],
						},
					},
				}),
			);

			// A provider has to exist for the run to get as far as submitting the
			// prompt. This one cannot be reached, so the run fails right after the
			// hook has seen the prompt - which is all this test needs.
			const result = spawnSync(
				process.execPath,
				[
					'--import=tsx',
					cliPath,
					'--trust-directory',
					'--plain',
					'run',
					'summarize the log',
				],
				{
					encoding: 'utf8',
					timeout: 60_000,
					input: 'x'.repeat(150_000),
					env: {
						...process.env,
						NANOCODER_CONFIG_DIR: configDir,
						NANOCODER_PROVIDERS: JSON.stringify([
							{
								name: 'unreachable',
								baseUrl: 'http://127.0.0.1:1/v1',
								apiKey: 'k',
								models: ['m'],
							},
						]),
						NODE_DISABLE_COMPILE_CACHE: '1',
						TSX_DISABLE_CACHE: '1',
					},
				},
			);

			const prompt = readFileSync(capture, 'utf8');
			t.true(
				prompt.startsWith('summarize the log'),
				`prompt did not start with the positional prompt: ${prompt.slice(0, 80)}`,
			);
			t.regex(prompt, /\n\n<stdin>\n/);
			t.regex(prompt, /\n<\/stdin>$/);
			t.true(
				prompt.includes('[stdin truncated - kept the first 100000 characters]'),
				'the cut note did not reach the model prompt',
			);

			// The piped text itself is capped, so a huge pipe cannot fill the
			// context window.
			const start = prompt.indexOf('<stdin>\n') + '<stdin>\n'.length;
			const body = prompt.slice(start, prompt.indexOf('\n\n[stdin truncated'));
			t.is(body.length, 100_000, result.stderr);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	},
);
