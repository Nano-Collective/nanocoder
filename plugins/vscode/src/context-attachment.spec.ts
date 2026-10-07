import test from 'ava';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	MAX_CONTEXT_DIR_ENTRIES,
	MAX_CONTEXT_FILE_BYTES,
	isBinary,
	readCappedDirectory,
	readCappedFile,
} from './context-attachment';

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-ctx-'));
	tempDirs.push(dir);
	return dir;
}

function writeFile(name: string, contents: string | Buffer): string {
	const filePath = path.join(makeTempDir(), name);
	fs.writeFileSync(filePath, contents);
	return filePath;
}

test.after.always(() => {
	for (const dir of tempDirs) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// ── readCappedFile ────────────────────────────────────────

test('readCappedFile - returns small files verbatim', t => {
	const filePath = writeFile('note.md', '# Title\n\nBody text.\n');

	t.is(readCappedFile(filePath), '# Title\n\nBody text.\n');
});

test('readCappedFile - returns an empty string for an empty file', t => {
	const filePath = writeFile('empty.txt', '');

	t.is(readCappedFile(filePath), '');
});

test('readCappedFile - truncates past the cap and says how much was dropped', t => {
	const filePath = writeFile('big.txt', 'x'.repeat(500));

	const result = readCappedFile(filePath, 100);

	t.true(result!.startsWith('x'.repeat(100)));
	t.true(
		result!.endsWith('... [truncated: 400 of 500 bytes omitted]'),
		'the marker must state the omission, never truncate silently',
	);
});

test('readCappedFile - a file exactly at the cap is not marked truncated', t => {
	const filePath = writeFile('exact.txt', 'y'.repeat(100));

	const result = readCappedFile(filePath, 100);

	t.is(result, 'y'.repeat(100));
	t.false(result!.includes('truncated'));
});

test('readCappedFile - rejects binary content', t => {
	const filePath = writeFile('image.bin', Buffer.from([0x89, 0x50, 0x00, 0x1a]));

	t.is(readCappedFile(filePath), null);
});

test('readCappedFile - a NUL past the sniff window does not trip the check', t => {
	// 9000 printable bytes then a NUL: beyond BINARY_SNIFF_BYTES, so this is
	// still treated as text rather than silently dropped.
	const buffer = Buffer.concat([
		Buffer.from('a'.repeat(9000)),
		Buffer.from([0x00]),
	]);
	const filePath = writeFile('late-nul.txt', buffer);

	t.not(readCappedFile(filePath), null);
});

test('readCappedFile - returns null for a missing file', t => {
	t.is(readCappedFile(path.join(makeTempDir(), 'nope.txt')), null);
});

test('readCappedFile - returns null for a directory', t => {
	t.is(readCappedFile(makeTempDir()), null);
});

test('readCappedFile - default cap is 100 KB', t => {
	t.is(MAX_CONTEXT_FILE_BYTES, 100 * 1024);
});

test('readCappedFile - applies the default cap when none is given', t => {
	const filePath = writeFile('huge.txt', 'z'.repeat(MAX_CONTEXT_FILE_BYTES + 250));

	const result = readCappedFile(filePath);

	t.true(result!.includes('... [truncated: 250 of'));
});

// ── isBinary ──────────────────────────────────────────────

test('isBinary - detects a NUL byte', t => {
	t.true(isBinary(Buffer.from([0x41, 0x00, 0x42])));
});

test('isBinary - passes plain text and an empty buffer', t => {
	t.false(isBinary(Buffer.from('const a = 1;\n')));
	t.false(isBinary(Buffer.alloc(0)));
});

// ── readCappedDirectory ───────────────────────────────────

test('readCappedDirectory - lists entries, marking directories with a slash', t => {
	const dir = makeTempDir();
	fs.writeFileSync(path.join(dir, 'index.ts'), '');
	fs.mkdirSync(path.join(dir, 'nested'));

	const lines = readCappedDirectory(dir).split('\n').sort();

	t.deepEqual(lines, ['index.ts', 'nested/']);
});

test('readCappedDirectory - caps entries and reports the remainder', t => {
	const dir = makeTempDir();
	for (let i = 0; i < 10; i++) {
		fs.writeFileSync(path.join(dir, `file${i}.txt`), '');
	}

	const lines = readCappedDirectory(dir, 4).split('\n');

	t.is(lines.length, 5, '4 entries plus the truncation marker');
	t.is(lines[4], '... [truncated: 6 more entries]');
});

test('readCappedDirectory - an empty directory yields an empty string', t => {
	t.is(readCappedDirectory(makeTempDir()), '');
});

test('readCappedDirectory - throws for a missing directory so the caller can report why', t => {
	t.throws(() => readCappedDirectory(path.join(makeTempDir(), 'absent')));
});

test('readCappedDirectory - default entry cap is 200', t => {
	t.is(MAX_CONTEXT_DIR_ENTRIES, 200);
});
