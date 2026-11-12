import {mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {type PlaceholderContent, PlaceholderType} from '../types/hooks.js';
import {
	handleFileMention,
	parseLineRangeFromMention,
} from './file-mention-handler.js';

console.log(`\nfile-mention-handler.spec.ts`);

// Test setup - create temp directory for test files
let testDir: string;

test.before(async () => {
	// Create a unique temp directory for our tests
	testDir = join(tmpdir(), `nanocoder-handler-test-${Date.now()}`);
	await mkdir(testDir, {recursive: true});

	// Create test files
	await writeFile(
		join(testDir, 'test.txt'),
		'Line 1\nLine 2\nLine 3\nLine 4\nLine 5',
		'utf-8',
	);

	await writeFile(
		join(testDir, 'app.tsx'),
		'import React from "react";\n\nexport function App() {\n  return <div>Hello</div>;\n}',
		'utf-8',
	);
});

test.after.always(async () => {
	// Clean up temp directory
	try {
		await rm(testDir, {recursive: true, force: true});
	} catch {
		// Ignore cleanup errors
	}
});

// Tests for handleFileMention()
test('creates placeholder for existing file', async t => {
	const filePath = join(testDir, 'test.txt');
	const result = await handleFileMention(
		filePath,
		'Check @test.txt',
		{},
		'@test.txt',
	);

	t.truthy(result);
	// Handler uses the filePath passed in for the placeholder display
	t.is(result!.displayValue, `Check [@${filePath}]`);
	t.is(Object.keys(result!.placeholderContent).length, 1);

	const placeholder = Object.values(result!.placeholderContent)[0];
	t.is(placeholder.type, PlaceholderType.FILE);
	t.true(placeholder.content.includes('Line 1'));
});

test('creates placeholder with line range', async t => {
	const filePath = join(testDir, 'test.txt');
	const result = await handleFileMention(
		filePath,
		'Check @test.txt:2-4',
		{},
		'@test.txt:2-4',
		{start: 2, end: 4},
	);

	t.truthy(result);
	t.is(result!.displayValue, `Check [@${filePath}:2-4]`);

	const placeholder = Object.values(result!.placeholderContent)[0];
	t.true(placeholder.content.includes('Line 2'));
	t.true(placeholder.content.includes('Line 4'));
	t.false(placeholder.content.includes('Line 1'));
});

test('creates placeholder with single line', async t => {
	const filePath = join(testDir, 'test.txt');
	const result = await handleFileMention(
		filePath,
		'Check @test.txt:3',
		{},
		'@test.txt:3',
		{start: 3},
	);

	t.truthy(result);
	t.is(result!.displayValue, `Check [@${filePath}:3]`);

	const placeholder = Object.values(result!.placeholderContent)[0];
	t.true(placeholder.content.includes('Line 3'));
});

test('returns null for non-existent file', async t => {
	const result = await handleFileMention(
		join(testDir, 'nonexistent.txt'),
		'Check @nonexistent.txt',
		{},
		'@nonexistent.txt',
	);

	t.is(result, null);
});

test('generates unique file IDs', async t => {
	// First file mention
	const result1 = await handleFileMention(
		join(testDir, 'test.txt'),
		'Check @test.txt',
		{},
		'@test.txt',
	);

	t.truthy(result1);
	t.true(Object.keys(result1!.placeholderContent).includes('file_1'));

	// Second file mention (with existing placeholder)
	const result2 = await handleFileMention(
		join(testDir, 'app.tsx'),
		'Check @test.txt and @app.tsx',
		result1!.placeholderContent,
		'@app.tsx',
	);

	t.truthy(result2);
	t.true(Object.keys(result2!.placeholderContent).includes('file_1'));
	t.true(Object.keys(result2!.placeholderContent).includes('file_2'));
});

test('preserves existing placeholders', async t => {
	const existingPlaceholder: Record<string, PlaceholderContent> = {
		file_1: {
			type: PlaceholderType.FILE,
			displayText: '[@existing.txt]',
			filePath: '/test/existing.txt',
			content: 'existing content',
			fileSize: 100,
		} as PlaceholderContent,
	};

	const result = await handleFileMention(
		join(testDir, 'test.txt'),
		'Check @test.txt',
		existingPlaceholder,
		'@test.txt',
	);

	t.truthy(result);
	t.is(Object.keys(result!.placeholderContent).length, 2);
	t.truthy(result!.placeholderContent.file_1);
	t.truthy(result!.placeholderContent.file_2);
});

test('replaces mention text in display value', async t => {
	const filePath = join(testDir, 'app.tsx');
	const result = await handleFileMention(
		filePath,
		'Please review the code in @app.tsx carefully',
		{},
		'@app.tsx',
	);

	t.truthy(result);
	t.is(
		result!.displayValue,
		`Please review the code in [@${filePath}] carefully`,
	);
});

test('handles multiple mentions in display value', async t => {
	const testPath = join(testDir, 'test.txt');
	const appPath = join(testDir, 'app.tsx');

	// First mention
	const result1 = await handleFileMention(
		testPath,
		'Compare @test.txt and @app.tsx',
		{},
		'@test.txt',
	);

	t.truthy(result1);

	// Second mention
	const result2 = await handleFileMention(
		appPath,
		result1!.displayValue,
		result1!.placeholderContent,
		'@app.tsx',
	);

	t.truthy(result2);
	t.is(result2!.displayValue, `Compare [@${testPath}] and [@${appPath}]`);
});

test('stores absolute path in placeholder', async t => {
	const relativePath = join(testDir, 'test.txt');
	const result = await handleFileMention(
		relativePath,
		'Check @test.txt',
		{},
		'@test.txt',
	);

	t.truthy(result);
	const placeholder = Object.values(result!.placeholderContent)[0];
	// Absolute path should be stored
	t.is(placeholder.type, PlaceholderType.FILE);
	if (placeholder.type === PlaceholderType.FILE) {
		t.true(placeholder.filePath.startsWith('/'));
		t.true(placeholder.filePath.includes('test.txt'));
	}
});

test('includes file content in placeholder', async t => {
	const result = await handleFileMention(
		join(testDir, 'app.tsx'),
		'Check @app.tsx',
		{},
		'@app.tsx',
	);

	t.truthy(result);
	const placeholder = Object.values(result!.placeholderContent)[0];
	t.truthy(placeholder.content);
	t.true(placeholder.content.length > 0);
	t.true(placeholder.content.includes('React'));
});

// Tests for parseLineRangeFromMention()
test('parseLineRangeFromMention parses range', t => {
	const result = parseLineRangeFromMention('@file.ts:10-20');
	t.deepEqual(result, {start: 10, end: 20});
});

test('parseLineRangeFromMention parses single line', t => {
	const result = parseLineRangeFromMention('@file.ts:10');
	t.deepEqual(result, {start: 10, end: undefined});
});

test('parseLineRangeFromMention returns undefined for no range', t => {
	const result = parseLineRangeFromMention('@file.ts');
	t.is(result, undefined);
});

test('parseLineRangeFromMention handles invalid range', t => {
	const result = parseLineRangeFromMention('@file.ts:abc');
	t.is(result, undefined);
});

test('parseLineRangeFromMention handles path with colons', t => {
	// Should only parse the last colon as line range
	const result = parseLineRangeFromMention('@src/path:to:file.ts:10-20');
	t.deepEqual(result, {start: 10, end: 20});
});
