import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	extractImagePathFromText,
	extractImageReferences,
	mediaTypeForPath,
	readClipboardImage,
	readImageFile,
	runClipboardCommand,
	type ClipboardCommandResult,
} from './clipboard-image.js';

// A 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/ouFAAAAAElFTkSuQmCC',
	'base64',
);

let dir: string;

test.before(() => {
	dir = mkdtempSync(join(tmpdir(), 'nanocoder-img-'));
});

test.after.always(() => {
	if (dir) rmSync(dir, {recursive: true, force: true});
});

test('mediaTypeForPath maps known image extensions', t => {
	t.is(mediaTypeForPath('a.png'), 'image/png');
	t.is(mediaTypeForPath('photo.JPG'), 'image/jpeg');
	t.is(mediaTypeForPath('x.jpeg'), 'image/jpeg');
	t.is(mediaTypeForPath('y.webp'), 'image/webp');
	t.is(mediaTypeForPath('z.gif'), 'image/gif');
});

test('mediaTypeForPath returns undefined for non-images', t => {
	t.is(mediaTypeForPath('notes.txt'), undefined);
	t.is(mediaTypeForPath('Makefile'), undefined);
	t.is(mediaTypeForPath('archive.png.zip'), undefined);
});

test('extractImagePathFromText resolves an existing image path', t => {
	const file = join(dir, 'shot.png');
	writeFileSync(file, PNG_BYTES);
	t.is(extractImagePathFromText(file), file);
	t.is(extractImagePathFromText(`  ${file}  `), file);
	t.is(extractImagePathFromText(`"${file}"`), file);
	t.is(extractImagePathFromText(`file://${file}`), file);
});

test('extractImagePathFromText handles backslash-escaped spaces', t => {
	const file = join(dir, 'my shot.png');
	writeFileSync(file, PNG_BYTES);
	// Shell-style escaping: escape backslashes first, then spaces, so a path
	// that already contains a backslash is encoded completely (not partially).
	const escaped = file.replace(/\\/g, '\\\\').replace(/ /g, '\\ ');
	t.is(extractImagePathFromText(escaped), file);
});

test('extractImagePathFromText ignores non-image and missing paths', t => {
	t.is(extractImagePathFromText('just some text'), undefined);
	t.is(extractImagePathFromText(join(dir, 'missing.png')), undefined);
	const txt = join(dir, 'notes.txt');
	writeFileSync(txt, 'hi');
	t.is(extractImagePathFromText(txt), undefined);
});

test('readImageFile returns a base64 attachment for an image', t => {
	const file = join(dir, 'read.png');
	writeFileSync(file, PNG_BYTES);
	const attachment = readImageFile(file);
	t.truthy(attachment);
	t.is(attachment?.mediaType, 'image/png');
	t.is(attachment?.data, PNG_BYTES.toString('base64'));
	t.is(attachment?.source, 'read.png');
});

test('readImageFile returns null for a non-image path', t => {
	const txt = join(dir, 'plain.txt');
	writeFileSync(txt, 'hi');
	t.is(readImageFile(txt), null);
});

test('extractImageReferences pulls a quoted path out of surrounding prose', t => {
	const file = join(dir, 'screen shot.png');
	writeFileSync(file, PNG_BYTES);
	const {text, paths} = extractImageReferences(
		`Give me text of the image'${file}'`,
	);
	t.deepEqual(paths, [file]);
	t.is(text, 'Give me text of the image[Image #1]');
});

test('extractImageReferences pulls an unquoted path token out of prose', t => {
	const file = join(dir, 'nospace.png');
	writeFileSync(file, PNG_BYTES);
	const {text, paths} = extractImageReferences(`look at ${file} please`);
	t.deepEqual(paths, [file]);
	t.is(text, 'look at [Image #1] please');
});

test('extractImageReferences pulls an unquoted escaped-space path out of prose', t => {
	// macOS terminals drop dragged paths in unquoted with spaces backslash-escaped.
	const file = join(dir, 'dragged shot.png');
	writeFileSync(file, PNG_BYTES);
	const escaped = file.replace(/\\/g, '\\\\').replace(/ /g, '\\ ');
	const {text, paths} = extractImageReferences(`describe ${escaped} please`);
	t.deepEqual(paths, [file]);
	t.is(text, 'describe [Image #1] please');
});

test('extractImageReferences leaves remote image URLs untouched', t => {
	const {text, paths} = extractImageReferences(
		'see https://example.com/chart.png for details',
	);
	t.deepEqual(paths, []);
	t.is(text, 'see https://example.com/chart.png for details');
	t.is(extractImagePathFromText('https://example.com/a.png'), undefined);
});

test('extractImageReferences leaves non-image and missing paths in place', t => {
	const {text, paths} = extractImageReferences(
		'see /tmp/missing.png and notes.txt',
	);
	t.deepEqual(paths, []);
	t.is(text, 'see /tmp/missing.png and notes.txt');
});

test('extractImageReferences returns multiple resolved paths', t => {
	const a = join(dir, 'a.png');
	const b = join(dir, 'b.jpg');
	writeFileSync(a, PNG_BYTES);
	writeFileSync(b, PNG_BYTES);
	const {text, paths} = extractImageReferences(`'${a}' and '${b}'`);
	t.deepEqual(paths.sort(), [a, b].sort());
	t.is(text, '[Image #1] and [Image #2]');
});

test('extractImageReferences numbers placeholders from startIndex', t => {
	const file = join(dir, 'offset.png');
	writeFileSync(file, PNG_BYTES);
	// startIndex counts attachments with no textual token (e.g. Ctrl+V pastes),
	// so the placeholder number lines up with the attachment order.
	const {text, paths} = extractImageReferences(`see '${file}'`, 2);
	t.deepEqual(paths, [file]);
	t.is(text, 'see [Image #3]');
});

function commandResult(
	overrides: Partial<ClipboardCommandResult> = {},
): ClipboardCommandResult {
	return {
		stdout: Buffer.alloc(0),
		missing: false,
		timedOut: false,
		tooLarge: false,
		failed: false,
		...overrides,
	};
}

test('readClipboardImage attaches PNG bytes streamed by wl-paste', async t => {
	const result = await readClipboardImage({
		platform: 'linux',
		run: async () => commandResult({stdout: PNG_BYTES}),
	});

	t.is(result.error, undefined);
	t.is(result.image?.data, PNG_BYTES.toString('base64'));
	t.is(result.image?.mediaType, 'image/png');
	t.is(result.image?.source, 'clipboard');
});

test('readClipboardImage falls back to xclip when wl-paste is missing', async t => {
	const calls: string[] = [];
	const result = await readClipboardImage({
		platform: 'linux',
		run: async command => {
			calls.push(command);
			return command === 'wl-paste'
				? commandResult({missing: true})
				: commandResult({stdout: PNG_BYTES});
		},
	});

	t.deepEqual(calls, ['wl-paste', 'xclip']);
	t.truthy(result.image);
});

test('readClipboardImage names the missing Linux helpers', async t => {
	const result = await readClipboardImage({
		platform: 'linux',
		run: async () => commandResult({missing: true}),
	});

	t.is(result.image, null);
	t.regex(result.error ?? '', /wl-paste or xclip/);
});

test('readClipboardImage reports a clipboard helper timeout', async t => {
	const result = await readClipboardImage({
		platform: 'linux',
		run: async () => commandResult({timedOut: true}),
	});

	t.is(result.image, null);
	t.regex(result.error ?? '', /timed out after 3s/);
});

test('readClipboardImage reports an oversized clipboard image', async t => {
	const result = await readClipboardImage({
		platform: 'win32',
		run: async () => commandResult({tooLarge: true}),
	});

	t.is(result.image, null);
	t.regex(result.error ?? '', /10 MB/);
});

test('readClipboardImage attaches PowerShell output on Windows', async t => {
	const result = await readClipboardImage({
		platform: 'win32',
		run: async () => commandResult({stdout: PNG_BYTES}),
	});

	t.is(result.error, undefined);
	t.is(result.image?.data, PNG_BYTES.toString('base64'));
});

test('readClipboardImage explains that Windows needs PowerShell', async t => {
	const result = await readClipboardImage({
		platform: 'win32',
		run: async () => commandResult({missing: true}),
	});

	t.is(result.image, null);
	t.regex(result.error ?? '', /PowerShell/);
});

test('readClipboardImage reports an unreadable clipboard', async t => {
	const result = await readClipboardImage({
		platform: 'linux',
		run: async () => commandResult({failed: true}),
	});

	t.is(result.image, null);
	t.regex(result.error ?? '', /Could not read the clipboard image/);
});

test('readClipboardImage treats an empty clipboard as a silent no-op', async t => {
	const result = await readClipboardImage({
		platform: 'linux',
		run: async () => commandResult(),
	});

	t.deepEqual(result, {image: null});
});

test('readClipboardImage explains that macOS needs osascript', async t => {
	const result = await readClipboardImage({
		platform: 'darwin',
		run: async () => commandResult({missing: true}),
	});

	t.is(result.image, null);
	t.regex(result.error ?? '', /osascript/);
});

test('readClipboardImage treats a non-image macOS clipboard as a no-op', async t => {
	const result = await readClipboardImage({
		platform: 'darwin',
		run: async () => commandResult({stdout: Buffer.from('NO_IMAGE')}),
	});

	t.deepEqual(result, {image: null});
});

test('readClipboardImage rejects a macOS temp file over the size limit', async t => {
	const result = await readClipboardImage({
		platform: 'darwin',
		run: async (_command, args) => {
			const outFile = /POSIX file "([^"]+)"/.exec(args[1] ?? '')?.[1];
			if (outFile) {
				writeFileSync(outFile, Buffer.alloc(10 * 1024 * 1024 + 1));
			}
			return commandResult({stdout: Buffer.from('OK')});
		},
	});

	t.is(result.image, null);
	t.regex(result.error ?? '', /10 MB/);
});

test('readClipboardImage returns no image on unsupported platforms', async t => {
	const result = await readClipboardImage({
		platform: 'aix',
		run: async () => commandResult({stdout: PNG_BYTES}),
	});

	t.deepEqual(result, {image: null});
});

test('runClipboardCommand flags an executable that is not installed', async t => {
	const result = await runClipboardCommand(
		'nanocoder-clipboard-helper-does-not-exist',
		[],
		{timeoutMs: 100},
	);

	t.true(result.missing);
	t.false(result.timedOut);
	t.false(result.tooLarge);
	t.false(result.failed);
	t.is(result.stdout.length, 0);
});

test('runClipboardCommand reports a helper that outlives its timeout', async t => {
	const result = await runClipboardCommand(
		process.execPath,
		['-e', 'setInterval(() => {}, 1000)'],
		{timeoutMs: 150},
	);

	t.true(result.timedOut);
	t.false(result.missing);
	t.false(result.tooLarge);
	t.false(result.failed);
});

test('runClipboardCommand returns stdout as bytes', async t => {
	const result = await runClipboardCommand(
		process.execPath,
		['-e', 'process.stdout.write(Buffer.from([1, 2, 3]))'],
		{timeoutMs: 5000},
	);

	t.deepEqual([...result.stdout], [1, 2, 3]);
	t.false(result.failed);
});

test('runClipboardCommand flags output over the size cap', async t => {
	const result = await runClipboardCommand(
		process.execPath,
		['-e', 'process.stdout.write(Buffer.alloc(4096))'],
		{timeoutMs: 5000, maxBytes: 1024},
	);

	t.true(result.tooLarge);
	t.false(result.timedOut);
	t.false(result.missing);
	t.false(result.failed);
});
