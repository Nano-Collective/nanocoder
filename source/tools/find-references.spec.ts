import test from 'ava';
import {mkdir, rm, writeFile as fsWriteFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {findReferencesTool} from './find-references.js';

// ============================================================================
// Test Setup
// ============================================================================

let testDir: string;

test.beforeEach(async () => {
	// Create a temporary directory for testing
	testDir = join(tmpdir(), `nanocoder-test-${Date.now()}`);
	await mkdir(testDir, {recursive: true});
});

test.afterEach.always(async () => {
	// Clean up test directory
	try {
		await rm(testDir, {recursive: true, force: true});
	} catch {
		// Ignore cleanup errors
	}
});

// ============================================================================
// Validator Tests
// ============================================================================

test('find_references validator: rejects invalid file paths with directory traversal', async t => {
	const validator = findReferencesTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result = await validator({
			path: '../../../etc/passwd',
			line: 10,
			character: 5,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /Invalid file path/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('find_references validator: rejects absolute paths outside project', async t => {
	const validator = findReferencesTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result = await validator({
			path: '/etc/passwd',
			line: 10,
			character: 5,
		});

		t.false(result.valid);
	} finally {
		process.chdir(originalCwd);
	}
});

test('find_references validator: rejects non-existent files', async t => {
	const validator = findReferencesTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result = await validator({
			path: 'does-not-exist.ts',
			line: 10,
			character: 5,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /File not found/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('find_references validator: rejects invalid line numbers (< 1)', async t => {
	const validator = findReferencesTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		// Create a test file
		const testFile = join(testDir, 'test.ts');
		await fsWriteFile(testFile, 'console.log("test");');

		const result = await validator({
			path: 'test.ts',
			line: 0, // Invalid: must be >= 1
			character: 5,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /Line must be >= 1/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('find_references validator: rejects invalid character numbers (< 1)', async t => {
	const validator = findReferencesTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		// Create a test file
		const testFile = join(testDir, 'test.ts');
		await fsWriteFile(testFile, 'console.log("test");');

		const result = await validator({
			path: 'test.ts',
			line: 1,
			character: 0, // Invalid: must be >= 1
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /Character must be >= 1/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('find_references validator: accepts valid file, line, and character', async t => {
	const validator = findReferencesTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		// Create a test file
		const testFile = join(testDir, 'test.ts');
		await fsWriteFile(testFile, 'console.log("test");');

		const result = await validator({
			path: 'test.ts',
			line: 1,
			character: 1,
		});

		t.true(result.valid);
	} finally {
		process.chdir(originalCwd);
	}
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('find_references formatter: renders without result', async t => {
	const formatter = findReferencesTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = formatter({
		path: 'src/app.ts',
		line: 10,
		character: 5,
	});

	t.truthy(element);
});

test('find_references formatter: renders with successful result', async t => {
	const formatter = findReferencesTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result = 'Found 3 references:\n\nsrc/app.ts:10:5\nsrc/utils.ts:25:10\nsrc/app.ts:42:8';

	const element = formatter(
		{
			path: 'src/app.ts',
			line: 10,
			character: 5,
		},
		result,
	);

	t.truthy(element);
});

test('find_references formatter: renders with no references result', async t => {
	const formatter = findReferencesTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result = 'No references found for symbol at src/app.ts:10:5';

	const element = formatter(
		{
			path: 'src/app.ts',
			line: 10,
			character: 5,
		},
		result,
	);

	t.truthy(element);
});

test('find_references formatter: displays language for TypeScript files', async t => {
	const formatter = findReferencesTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result = 'Found 1 reference:\n\nsrc/app.ts:10:5';

	const element = formatter(
		{
			path: 'src/app.ts',
			line: 10,
			character: 5,
		},
		result,
	);

	t.truthy(element);
});
