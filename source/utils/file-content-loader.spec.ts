import {mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {MAX_FILE_TAG_SIZE_BYTES} from '@/constants.js';
import {loadFileContent} from './file-content-loader.js';

console.log(`\nfile-content-loader.spec.ts`);

// Test setup - create temp directory for test files
let testDir: string;

test.before(async () => {
	// Create a unique temp directory for our tests
	testDir = join(tmpdir(), `nanocoder-test-${Date.now()}`);
	await mkdir(testDir, {recursive: true});

	// Create test files
	await writeFile(
		join(testDir, 'test.txt'),
		'Line 1\nLine 2\nLine 3\nLine 4\nLine 5',
		'utf-8',
	);

	await writeFile(
	join(testDir, 'trailing-newline.txt'),
	'Line 1\nLine 2\nLine 3\n',
	'utf-8',
);

	await writeFile(
		join(testDir, 'app.tsx'),
		'import React from "react";\n\nexport function App() {\n  return <div>Hello</div>;\n}',
		'utf-8',
	);

	// Create a binary file (by extension)
	await writeFile(join(testDir, 'image.gif'), Buffer.from('GIF89a'));

	// Create a large text file exceeding the size limit
	const largeContent = 'x'.repeat(MAX_FILE_TAG_SIZE_BYTES + 1);
	await writeFile(join(testDir, 'huge.csv'), largeContent, 'utf-8');
});

test.after.always(async () => {
	// Clean up temp directory
	try {
		await rm(testDir, {recursive: true, force: true});
	} catch {
		// Ignore cleanup errors
	}
});

test('omits line range from header when no range is specified', async t => {
	const filePath = join(testDir, 'test.txt');
	const result = await loadFileContent(filePath);

	t.true(result.success);
	t.true(result.content!.startsWith(`Path: ${filePath}\n\n`));
	t.false(result.content!.startsWith(`Path: ${filePath} (lines `));
});

// Tests for loadFileContent()
test('loads file content successfully', async t => {
	const result = await loadFileContent(join(testDir, 'test.txt'));

	t.true(result.success);
	t.truthy(result.content);
	t.is(result.metadata.lineCount, 5);
	t.true(result.metadata.size > 0);
});

test('loads file with line range', async t => {
	const result = await loadFileContent(join(testDir, 'test.txt'), {
		start: 2,
		end: 4,
	});

	t.true(result.success);
	t.truthy(result.content);
	t.is(result.metadata.lineCount, 3); // Lines 2, 3, 4
	t.deepEqual(result.metadata.lineRange, {start: 2, end: 4});
});

test('loads single line', async t => {
	const result = await loadFileContent(join(testDir, 'test.txt'), {
		start: 3,
	});

	t.true(result.success);
	t.true(
	result.content!.startsWith(
		`Path: ${join(testDir, 'test.txt')} (lines 3-3)`,
	),
   );
	t.is(result.metadata.lineCount, 1);
	t.deepEqual(result.metadata.lineRange, {start: 3, end: undefined});
});

test('handles line range beyond file length', async t => {
	const result = await loadFileContent(join(testDir, 'test.txt'), {
		start: 3,
		end: 100,
	});

	t.true(result.success);
	t.true(
	result.content!.startsWith(
		`Path: ${join(testDir, 'test.txt')} (lines 3-5)`,
	),
);
	t.is(result.metadata.lineCount, 3); // Lines 3, 4, 5 (only 3 lines available)
});

test('handles line start beyond file length', async t => {
	const result = await loadFileContent(join(testDir, 'test.txt'), {
		start: 100,
		end: 200,
	});

	t.true(result.success);
	t.true(
	result.content!.startsWith(
		`Path: ${join(testDir, 'test.txt')}\n\n`,
	),
);
	t.is(result.metadata.lineCount, 0); // No lines available
});

test('clamps line range to last real line when file ends with newline', async t => {
	const filePath = join(testDir, 'trailing-newline.txt');
	const result = await loadFileContent(filePath, {
		start: 1,
		end: 100,
	});

	t.true(result.success);
	t.is(result.metadata.lineCount, 3);
	t.deepEqual(result.metadata.lineRange, {start: 1, end: 3});
	t.true(result.content!.startsWith(`Path: ${filePath} (lines 1-3)`));
});

test('handles non-existent file', async t => {
	const result = await loadFileContent(join(testDir, 'nonexistent.txt'));

	t.false(result.success);
	t.truthy(result.error);
	t.is(result.metadata.size, 0);
	t.is(result.metadata.lineCount, 0);
});

test('formats content with path header', async t => {
	const testFilePath = join(testDir, 'test.txt');
	const result = await loadFileContent(testFilePath, {
		start: 2,
		end: 3,
	});

	t.true(result.success);
	t.truthy(result.content);
	// Should have path header and content without line numbers
	t.true(result.content!.startsWith(`Path: ${testFilePath} (lines 2-3)`));
	t.true(result.content!.includes('Line 2'));
	t.true(result.content!.includes('Line 3'));
});

test('calculates token estimate', async t => {
	const result = await loadFileContent(join(testDir, 'test.txt'));

	t.true(result.success);
	t.true(result.metadata.tokens > 0);
	// Rough token estimate should be ~1/4 of character count
	t.true(result.metadata.tokens <= result.metadata.size);
});

test('stores absolute path in metadata', async t => {
	const relativePath = join(testDir, 'test.txt');
	const result = await loadFileContent(relativePath);

	t.true(result.success);
	t.is(result.metadata.path, relativePath);
	t.truthy(result.metadata.absolutePath);
	// Absolute path should be longer or equal (handles relative paths)
	t.true(result.metadata.absolutePath.length >= relativePath.length);
});

test('returns metadata for binary file extensions', async t => {
	const result = await loadFileContent(join(testDir, 'image.gif'));

	t.true(result.success);
	t.truthy(result.content);
	t.true(result.content!.includes('[Binary file:'));
	t.true(result.content!.includes('Type: GIF'));
	t.true(result.content!.includes('Binary files cannot be included'));
	t.is(result.metadata.lineCount, 0);
});

test('returns metadata for files exceeding size limit', async t => {
	const result = await loadFileContent(join(testDir, 'huge.csv'));

	t.true(result.success);
	t.truthy(result.content);
	t.true(result.content!.includes('[Large file:'));
	t.true(result.content!.includes('exceeds'));
	t.true(result.content!.includes('limit for inline tagging'));
	t.is(result.metadata.lineCount, 0);
});

test('allows large files when line range is specified', async t => {
	const result = await loadFileContent(join(testDir, 'huge.csv'), {
		start: 1,
		end: 1,
	});

	t.true(result.success);
	// Should load the content (not metadata) since a line range was given
	t.true(result.content!.startsWith('Path:'));
});

