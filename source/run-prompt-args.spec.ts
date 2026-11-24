import {Readable} from 'node:stream';
import test from 'ava';
import {
	composePromptWithStdin,
	parseRunPrompt,
	readStdinText,
	STDIN_PROMPT_FILE,
} from './run-prompt-args.js';

// Piped stdin for `nanocoder run`: how it folds into the prompt, how it is
// capped, and how it is read. The CLI wiring is covered end to end in
// run-stdin.cli-integration.spec.ts.

const MAX = 100;

test('stdin is appended to the prompt in a <stdin> block', t => {
	t.is(
		composePromptWithStdin('write a commit message', 'diff --git a b', MAX),
		'write a commit message\n\n<stdin>\ndiff --git a b\n</stdin>',
	);
});

test('stdin alone becomes the prompt', t => {
	t.is(composePromptWithStdin(undefined, 'why did this fail', MAX), 'why did this fail');
	t.is(composePromptWithStdin('', 'why did this fail', MAX), 'why did this fail');
	t.is(composePromptWithStdin('  \n', 'why did this fail', MAX), 'why did this fail');
});

test('trailing newlines from the pipe do not leak into the block', t => {
	t.is(
		composePromptWithStdin('summarize', 'line one\nline two\n\n', MAX),
		'summarize\n\n<stdin>\nline one\nline two\n</stdin>',
	);
});

test('empty or whitespace-only stdin leaves the prompt untouched', t => {
	// A non-TTY with nothing piped (CI with stdin on /dev/null) must behave
	// exactly as it did before stdin was read at all.
	t.is(composePromptWithStdin('do a thing', '', MAX), 'do a thing');
	t.is(composePromptWithStdin('do a thing', ' \n\t\n', MAX), 'do a thing');
	t.is(composePromptWithStdin(undefined, '', MAX), undefined);
	t.is(composePromptWithStdin(undefined, '\n', MAX), undefined);
});

test('stdin over the cap is cut and says so', t => {
	const result = composePromptWithStdin('review', 'x'.repeat(250), MAX);
	t.is(
		result,
		`review\n\n<stdin>\n${'x'.repeat(MAX)}\n\n[stdin truncated - kept the first ${MAX} characters]\n</stdin>`,
	);
});

test('stdin exactly at the cap is not marked truncated', t => {
	const result = composePromptWithStdin('review', 'x'.repeat(MAX), MAX);
	t.false(result?.includes('truncated'));
	t.true(result?.includes('x'.repeat(MAX)));
});

test('truncated stdin used as the prompt still carries the note', t => {
	const result = composePromptWithStdin(undefined, 'y'.repeat(250), MAX);
	t.is(
		result,
		`${'y'.repeat(MAX)}\n\n[stdin truncated - kept the first ${MAX} characters]`,
	);
});

test('the cut never splits a surrogate pair', t => {
	// Each emoji is two UTF-16 units, so a cap of 5 lands in the middle of the
	// third one. A lone half would render as a replacement character.
	const result = composePromptWithStdin(undefined, '😀'.repeat(10), 5) ?? '';
	const kept = result.split('\n\n[stdin truncated')[0];
	t.is(kept, '😀😀');
	t.notRegex(kept, /[\ud800-\udbff](?![\udc00-\udfff])/);
});

test('--prompt-file value for stdin is a single dash', t => {
	t.is(STDIN_PROMPT_FILE, '-');
});

test('--prompt-file - is not mistaken for part of the prompt', t => {
	// The dash is the flag's value, so it is skipped with the flag rather than
	// becoming the first word of the prompt.
	t.is(parseRunPrompt(['run', '--prompt-file', '-']), '');
	t.is(parseRunPrompt(['run', 'do', '--prompt-file', '-', 'this']), 'do this');
});

test('readStdinText joins chunks', async t => {
	t.is(await readStdinText(Readable.from(['abc', 'def']), MAX), 'abcdef');
});

test('readStdinText decodes a multi-byte character split across chunks', async t => {
	const bytes = Buffer.from('héllo', 'utf8');
	// Cut inside the two-byte "é".
	const stream = Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]);
	t.is(await readStdinText(stream, MAX), 'héllo');
});

test('readStdinText stops once past the cap instead of buffering everything', async t => {
	let produced = 0;
	async function* source() {
		for (let i = 0; i < 1_000; i++) {
			produced++;
			yield 'x'.repeat(50);
		}
	}
	const text = await readStdinText(source(), MAX);
	// Enough was read to know the cap was exceeded, and no more than that.
	t.true(text.length > MAX);
	t.true(produced <= 3, `read ${produced} chunks`);
});

test('readStdinText returns an empty string for an empty stream', async t => {
	t.is(await readStdinText(Readable.from([]), MAX), '');
});
