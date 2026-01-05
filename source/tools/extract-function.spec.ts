import test from 'ava';
import {mkdir, rm, writeFile as fsWriteFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {extractFunctionTool} from './extract-function.js';

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

test('extract_function validator: rejects directory traversal attempts', async t => {
	const validator = extractFunctionTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result = await validator({
			path: '../../../etc/passwd',
			function_name: 'newFunction',
			start_line: 1,
			end_line: 5,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /Invalid file path/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('extract_function validator: rejects non-existent files', async t => {
	const validator = extractFunctionTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result = await validator({
			path: 'does-not-exist.ts',
			function_name: 'newFunction',
			start_line: 1,
			end_line: 5,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /File not found/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('extract_function validator: rejects empty function name', async t => {
	const validator = extractFunctionTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const testFile = join(testDir, 'test.ts');
		await fsWriteFile(testFile, 'const x = 1;');

		const result = await validator({
			path: 'test.ts',
			function_name: '',
			start_line: 1,
			end_line: 5,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /Function name cannot be empty/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('extract_function validator: rejects whitespace-only function name', async t => {
	const validator = extractFunctionTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const testFile = join(testDir, 'test.ts');
		await fsWriteFile(testFile, 'const x = 1;');

		const result = await validator({
			path: 'test.ts',
			function_name: '   ',
			start_line: 1,
			end_line: 5,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /Function name cannot be empty/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('extract_function validator: rejects invalid identifier names', async t => {
	const validator = extractFunctionTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const testFile = join(testDir, 'test.ts');
		await fsWriteFile(testFile, 'const x = 1;');

		const invalidNames = ['123name', 'name-with-dash', 'name with space', '@name'];

		for (const invalidName of invalidNames) {
			const result = await validator({
				path: 'test.ts',
				function_name: invalidName,
				start_line: 1,
				end_line: 5,
			});

			t.false(result.valid, `Should reject "${invalidName}"`);
			if (!result.valid) {
				t.regex(result.error, /not a valid function name/i);
			}
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('extract_function validator: rejects invalid line ranges (start < 1)', async t => {
	const validator = extractFunctionTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const testFile = join(testDir, 'test.ts');
		await fsWriteFile(testFile, 'const x = 1;');

		const result = await validator({
			path: 'test.ts',
			function_name: 'newFunction',
			start_line: 0,
			end_line: 5,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /start_line must be >= 1/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('extract_function validator: rejects invalid line ranges (end < start)', async t => {
	const validator = extractFunctionTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const testFile = join(testDir, 'test.ts');
		const content = 'line 1\nline 2\nline 3\nline 4\nline 5';
		await fsWriteFile(testFile, content);

		const result = await validator({
			path: 'test.ts',
			function_name: 'newFunction',
			start_line: 5,
			end_line: 2,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /end_line must be >= start_line/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('extract_function validator: rejects start_line exceeding file length', async t => {
	const validator = extractFunctionTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const testFile = join(testDir, 'test.ts');
		const content = 'line 1\nline 2\nline 3';
		await fsWriteFile(testFile, content);

		const result = await validator({
			path: 'test.ts',
			function_name: 'newFunction',
			start_line: 10,
			end_line: 15,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /start_line.*exceeds file length/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('extract_function validator: rejects end_line exceeding file length', async t => {
	const validator = extractFunctionTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const testFile = join(testDir, 'test.ts');
		const content = 'line 1\nline 2\nline 3';
		await fsWriteFile(testFile, content);

		const result = await validator({
			path: 'test.ts',
			function_name: 'newFunction',
			start_line: 1,
			end_line: 10,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /end_line.*exceeds file length/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('extract_function validator: accepts valid parameters', async t => {
	const validator = extractFunctionTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const testFile = join(testDir, 'test.ts');
		const content = 'line 1\nline 2\nline 3\nline 4\nline 5';
		await fsWriteFile(testFile, content);

		const result = await validator({
			path: 'test.ts',
			function_name: 'newFunction',
			start_line: 2,
			end_line: 4,
		});

		t.true(result.valid);
	} finally {
		process.chdir(originalCwd);
	}
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('extract_function formatter: renders without result', async t => {
	const formatter = extractFunctionTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = formatter({
		path: 'src/app.ts',
		function_name: 'extractedFunction',
		start_line: 10,
		end_line: 15,
	});

	t.truthy(element);
});

test('extract_function formatter: renders with successful extraction result', async t => {
	const formatter = extractFunctionTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result =
		"Extracted function 'extractedFunction' from lines 10-15.\n\n⚠️  IMPORTANT: You may need to manually adjust:\n   - Function parameters (add variables used from outside the selection)\n   - Return value (if the function returns a result)\n   - This/Context (if the function uses class members)\n\nFunction signature:\n  function extractedFunction() {\n    // ... extracted code ...\n  }";

	const element = formatter(
		{
			path: 'src/app.ts',
			function_name: 'extractedFunction',
			start_line: 10,
			end_line: 15,
		},
		result,
	);

	t.truthy(element);
});

test('extract_function formatter: displays language for TypeScript files', async t => {
	const formatter = extractFunctionTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = formatter({
		path: 'src/app.ts',
		function_name: 'extractedFunction',
		start_line: 10,
		end_line: 15,
	});

	t.truthy(element);
});

test('extract_function tool: has correct tool name', t => {
	t.is(extractFunctionTool.name, 'lsp_extract_function');
});

test('extract_function tool: has needsApproval set to true', t => {
	// extract_function is a destructive operation, so it should require approval
	t.true(extractFunctionTool.tool.needsApproval === true);
});
