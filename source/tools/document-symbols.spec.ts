import test from 'ava';
import {mkdir, rm, writeFile as fsWriteFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {documentSymbolsTool} from './document-symbols.js';

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

test('document_symbols validator: rejects directory traversal attempts', async t => {
	const validator = documentSymbolsTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result = await validator({
			path: '../../../etc/passwd',
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /Invalid file path/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('document_symbols validator: rejects non-existent files', async t => {
	const validator = documentSymbolsTool.validator;
	if (!validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();

	try {
		process.chdir(testDir);

		const result = await validator({
			path: 'does-not-exist.ts',
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /File not found/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('document_symbols validator: accepts valid files', async t => {
	const validator = documentSymbolsTool.validator;
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
		});

		t.true(result.valid);
	} finally {
		process.chdir(originalCwd);
	}
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('document_symbols formatter: renders without result', async t => {
	const formatter = documentSymbolsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = formatter({
		path: 'src/app.ts',
	});

	t.truthy(element);
});

test('document_symbols formatter: renders with symbols found', async t => {
	const formatter = documentSymbolsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result = 'Found 5 symbols in src/app.ts:\n\nFunction: getUserById (line 5)\nClass: UserService (line 10)';

	const element = formatter(
		{
			path: 'src/app.ts',
		},
		result,
	);

	t.truthy(element);
});

test('document_symbols formatter: renders with no symbols found', async t => {
	const formatter = documentSymbolsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result = 'No symbols found in src/app.ts';

	const element = formatter(
		{
			path: 'src/app.ts',
		},
		result,
	);

	t.truthy(element);
});

test('document_symbols formatter: renders with kind filter', async t => {
	const formatter = documentSymbolsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = formatter({
		path: 'src/app.ts',
		kind: 'Function',
	});

	t.truthy(element);
});

test('document_symbols formatter: displays language for JavaScript files', async t => {
	const formatter = documentSymbolsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result = 'Found 3 symbols in src/app.js:\n\nFunction: foo (line 1)';

	const element = formatter(
		{
			path: 'src/app.js',
		},
		result,
	);

	t.truthy(element);
});

test('document_symbols tool: has correct tool name', t => {
	t.is(documentSymbolsTool.name, 'lsp_document_symbols');
});

test('document_symbols tool: has needsApproval function', t => {
	t.is(typeof documentSymbolsTool.tool.needsApproval, 'function');
});
