import test from 'ava';
import {mkdir, rm, writeFile as fsWriteFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {renameSymbolTool} from './rename-symbol.js';

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

test('rename_symbol validator: rejects directory traversal attempts', async t => {
	const validator = renameSymbolTool.validator;
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
			new_name: 'newName',
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /Invalid file path/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('rename_symbol validator: rejects non-existent files', async t => {
	const validator = renameSymbolTool.validator;
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
			new_name: 'newName',
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /File not found/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('rename_symbol validator: rejects invalid line numbers (< 1)', async t => {
	const validator = renameSymbolTool.validator;
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
			line: 0,
			character: 5,
			new_name: 'newName',
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /Line must be >= 1/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('rename_symbol validator: rejects invalid character numbers (< 1)', async t => {
	const validator = renameSymbolTool.validator;
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
			line: 1,
			character: 0,
			new_name: 'newName',
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /Character must be >= 1/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('rename_symbol validator: rejects empty new name', async t => {
	const validator = renameSymbolTool.validator;
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
			line: 1,
			character: 1,
			new_name: '',
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /New name cannot be empty/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('rename_symbol validator: rejects whitespace-only new name', async t => {
	const validator = renameSymbolTool.validator;
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
			line: 1,
			character: 1,
			new_name: '   ',
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /New name cannot be empty/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('rename_symbol validator: rejects invalid identifier names', async t => {
	const validator = renameSymbolTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const testFile = join(testDir, 'test.ts');
		await fsWriteFile(testFile, 'const x = 1;');

		// Test various invalid identifiers
		const invalidNames = ['123name', 'name-with-dash', 'name with space', '@name'];

		for (const invalidName of invalidNames) {
			const result = await validator({
				path: 'test.ts',
				line: 1,
				character: 1,
				new_name: invalidName,
			});

			t.false(result.valid, `Should reject "${invalidName}"`);
			if (!result.valid) {
				t.regex(result.error, /not a valid identifier/i);
			}
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('rename_symbol validator: accepts valid identifier names', async t => {
	const validator = renameSymbolTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const testFile = join(testDir, 'test.ts');
		await fsWriteFile(testFile, 'const x = 1;');

		// Test various valid identifiers
		const validNames = [
			'name',
			'Name',
			'_name',
			'$name',
			'name123',
			'camelCase',
			'PascalCase',
			'snake_case',
		];

		for (const validName of validNames) {
			const result = await validator({
				path: 'test.ts',
				line: 1,
				character: 1,
				new_name: validName,
			});

			t.true(result.valid, `Should accept "${validName}"`);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('rename_symbol validator: accepts valid parameters', async t => {
	const validator = renameSymbolTool.validator;
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
			line: 1,
			character: 1,
			new_name: 'newName',
		});

		t.true(result.valid);
	} finally {
		process.chdir(originalCwd);
	}
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('rename_symbol formatter: renders without result', async t => {
	const formatter = renameSymbolTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = formatter({
		path: 'src/app.ts',
		line: 10,
		character: 5,
		new_name: 'newName',
	});

	t.truthy(element);
});

test('rename_symbol formatter: renders with successful rename result', async t => {
	const formatter = renameSymbolTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result =
		"Renamed symbol to 'newName'.\n\nModified 3 files with 5 changes:\n\nsrc/app.ts: 3 changes\nsrc/utils.ts: 1 change\nsrc/types.ts: 1 change";

	const element = formatter(
		{
			path: 'src/app.ts',
			line: 10,
			character: 5,
			new_name: 'newName',
		},
		result,
	);

	t.truthy(element);
});

test('rename_symbol formatter: renders with no changes result', async t => {
	const formatter = renameSymbolTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result =
		"No changes needed. Symbol is already named 'newName' or could not be renamed.";

	const element = formatter(
		{
			path: 'src/app.ts',
			line: 10,
			character: 5,
			new_name: 'newName',
		},
		result,
	);

	t.truthy(element);
});

test('rename_symbol formatter: displays language for TypeScript files', async t => {
	const formatter = renameSymbolTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result = "Renamed symbol to 'newName'.\n\nModified 1 file with 1 change:\n\nsrc/app.ts: 1 change";

	const element = formatter(
		{
			path: 'src/app.ts',
			line: 10,
			character: 5,
			new_name: 'newName',
		},
		result,
	);

	t.truthy(element);
});

test('rename_symbol tool: has correct tool name', t => {
	t.is(renameSymbolTool.name, 'lsp_rename_symbol');
});

test('rename_symbol tool: has needsApproval set to true', t => {
	// rename_symbol is a destructive operation, so it should require approval
	t.true(renameSymbolTool.tool.needsApproval === true);
});
