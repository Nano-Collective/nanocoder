import test from 'ava';
import {mkdir, rm, writeFile as fsWriteFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeFileTool} from './file-ops/write-file.js';
import {stringReplaceTool} from './file-ops/string-replace.js';
import {readFileTool} from './read-file.js';

// ============================================================================
// Test Setup
// ============================================================================

/*
Testing Strategy:

These tests verify that the file manipulation tools (write_file, string_replace,
read_file) properly validate file paths to prevent security vulnerabilities such as:

1. Directory traversal attacks (../)
2. Absolute path escapes (/etc/passwd, C:\Windows\System32)
3. Null byte injection (\0)
4. Paths that escape the project directory

Each tool has a validator function that should reject these dangerous paths
before any file operations are performed.
*/

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
// write_file Validator Tests
// ============================================================================

test('write_file validator: rejects directory traversal attempts', async (t) => {
	const validator = writeFileTool.validator;
	if (!validator) {
		t.fail('write_file validator not defined');
		return;
	}

	// Save original cwd
	const originalCwd = process.cwd();

	try {
		// Change to test directory
		process.chdir(testDir);

		// Test various directory traversal attempts
		const result1 = await validator({
			path: '../etc/passwd',
			content: 'malicious',
		});
		t.false(result1.valid, 'Should reject ../ path');
		if (!result1.valid) {
			t.regex(result1.error, /Invalid file path/i);
		}

		const result2 = await validator({
			path: '../../secret.txt',
			content: 'malicious',
		});
		t.false(result2.valid, 'Should reject ../../ path');

		const result3 = await validator({
			path: 'src/../../../etc/passwd',
			content: 'malicious',
		});
		t.false(result3.valid, 'Should reject nested .. path');
	} finally {
		// Restore original cwd
		process.chdir(originalCwd);
	}
});

test('write_file validator: rejects absolute paths', async (t) => {
	const validator = writeFileTool.validator;
	if (!validator) {
		t.fail('write_file validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		// Unix absolute path
		const result1 = await validator({
			path: '/etc/passwd',
			content: 'malicious',
		});
		t.false(result1.valid, 'Should reject Unix absolute path');
		if (!result1.valid) {
			t.regex(result1.error, /Invalid file path/i);
		}

		// Windows absolute path
		const result2 = await validator({
			path: 'C:\\Windows\\System32\\config',
			content: 'malicious',
		});
		t.false(result2.valid, 'Should reject Windows absolute path');
	} finally {
		process.chdir(originalCwd);
	}
});

test('write_file validator: rejects null byte injection', async (t) => {
	const validator = writeFileTool.validator;
	if (!validator) {
		t.fail('write_file validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result = await validator({
			path: 'file\0.txt',
			content: 'malicious',
		});
		t.false(result.valid, 'Should reject null byte in path');
		if (!result.valid) {
			t.regex(result.error, /Invalid file path/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('write_file validator: accepts valid relative paths', async (t) => {
	const validator = writeFileTool.validator;
	if (!validator) {
		t.fail('write_file validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		// Create a subdirectory for testing
		await mkdir(join(testDir, 'src'), {recursive: true});

		const result = await validator({
			path: 'src/test.txt',
			content: 'safe content',
		});

		t.true(result.valid, 'Should accept valid relative path');
	} finally {
		process.chdir(originalCwd);
	}
});

// ============================================================================
// string_replace Validator Tests
// ============================================================================

test('string_replace validator: rejects directory traversal attempts', async (t) => {
	const validator = stringReplaceTool.validator;
	if (!validator) {
		t.fail('string_replace validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result1 = await validator({
			path: '../etc/passwd',
			old_str: 'old',
			new_str: 'new',
		});
		t.false(result1.valid, 'Should reject ../ path');
		if (!result1.valid) {
			t.regex(result1.error, /Invalid file path/i);
		}

		const result2 = await validator({
			path: '../../secret.txt',
			old_str: 'old',
			new_str: 'new',
		});
		t.false(result2.valid, 'Should reject ../../ path');
	} finally {
		process.chdir(originalCwd);
	}
});

test('string_replace validator: rejects absolute paths', async (t) => {
	const validator = stringReplaceTool.validator;
	if (!validator) {
		t.fail('string_replace validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result1 = await validator({
			path: '/etc/passwd',
			old_str: 'old',
			new_str: 'new',
		});
		t.false(result1.valid, 'Should reject Unix absolute path');
		if (!result1.valid) {
			t.regex(result1.error, /Invalid file path/i);
		}

		const result2 = await validator({
			path: 'C:\\Windows\\System32',
			old_str: 'old',
			new_str: 'new',
		});
		t.false(result2.valid, 'Should reject Windows absolute path');
	} finally {
		process.chdir(originalCwd);
	}
});

test('string_replace validator: rejects null byte injection', async (t) => {
	const validator = stringReplaceTool.validator;
	if (!validator) {
		t.fail('string_replace validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result = await validator({
			path: 'file\0.txt',
			old_str: 'old',
			new_str: 'new',
		});
		t.false(result.valid, 'Should reject null byte in path');
		if (!result.valid) {
			t.regex(result.error, /Invalid file path/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('string_replace validator: accepts valid relative paths', async (t) => {
	const validator = stringReplaceTool.validator;
	if (!validator) {
		t.fail('string_replace validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		// Create a test file
		const testFile = join(testDir, 'test.txt');
		await fsWriteFile(testFile, 'old content', 'utf-8');

		const result = await validator({
			path: 'test.txt',
			old_str: 'old content',
			new_str: 'new content',
		});

		t.true(result.valid, 'Should accept valid relative path');
	} finally {
		process.chdir(originalCwd);
	}
});

// ============================================================================
// read_file Validator Tests
// ============================================================================

test('read_file validator: rejects directory traversal attempts', async (t) => {
	const validator = readFileTool.validator;
	if (!validator) {
		t.fail('read_file validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result1 = await validator({
			path: '../etc/passwd',
		});
		t.false(result1.valid, 'Should reject ../ path');
		if (!result1.valid) {
			t.regex(result1.error, /Invalid file path/i);
		}

		const result2 = await validator({
			path: '../../secret.txt',
		});
		t.false(result2.valid, 'Should reject ../../ path');
	} finally {
		process.chdir(originalCwd);
	}
});

test('read_file validator: rejects absolute paths', async (t) => {
	const validator = readFileTool.validator;
	if (!validator) {
		t.fail('read_file validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result1 = await validator({
			path: '/etc/passwd',
		});
		t.false(result1.valid, 'Should reject Unix absolute path');
		if (!result1.valid) {
			t.regex(result1.error, /Invalid file path/i);
		}

		const result2 = await validator({
			path: 'C:\\Windows\\System32',
		});
		t.false(result2.valid, 'Should reject Windows absolute path');
	} finally {
		process.chdir(originalCwd);
	}
});

test('read_file validator: rejects null byte injection', async (t) => {
	const validator = readFileTool.validator;
	if (!validator) {
		t.fail('read_file validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result = await validator({
			path: 'file\0.txt',
		});
		t.false(result.valid, 'Should reject null byte in path');
		if (!result.valid) {
			t.regex(result.error, /Invalid file path/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('read_file validator: accepts valid relative paths', async (t) => {
	const validator = readFileTool.validator;
	if (!validator) {
		t.fail('read_file validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		// Create a test file
		const testFile = join(testDir, 'test.txt');
		await fsWriteFile(testFile, 'test content', 'utf-8');

		const result = await validator({
			path: 'test.txt',
		});

		t.true(result.valid, 'Should accept valid relative path');
	} finally {
		process.chdir(originalCwd);
	}
});

// ============================================================================
// Cross-tool Security Tests
// ============================================================================

test('all tools: consistently reject common attack vectors', async (t) => {
	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const attackVectors = [
			'../../../etc/passwd',
			'/etc/passwd',
			'C:\\Windows\\System32',
			'file\0.txt',
		];

		for (const vector of attackVectors) {
			// Test write_file
			if (writeFileTool.validator) {
				const writeResult = await writeFileTool.validator({
					path: vector,
					content: 'test',
				});
				t.false(
					writeResult.valid,
					`write_file should reject: ${vector}`,
				);
			}

			// Test string_replace
			if (stringReplaceTool.validator) {
				const replaceResult = await stringReplaceTool.validator({
					path: vector,
					old_str: 'old',
					new_str: 'new',
				});
				t.false(
					replaceResult.valid,
					`string_replace should reject: ${vector}`,
				);
			}

			// Test read_file
			if (readFileTool.validator) {
				const readResult = await readFileTool.validator({
					path: vector,
				});
				t.false(
					readResult.valid,
					`read_file should reject: ${vector}`,
				);
			}
		}
	} finally {
		process.chdir(originalCwd);
	}
});
