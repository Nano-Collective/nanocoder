import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
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
