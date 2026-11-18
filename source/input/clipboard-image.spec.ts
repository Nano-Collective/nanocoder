import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	extractImagePathFromText,
	extractImageReferences,
	mediaTypeForPath,
	readImageFile,
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
