import test from 'ava';
import {mkdir, rm, writeFile as fsWriteFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {goToDefinitionTool} from './go-to-definition.js';

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

test('go_to_definition validator: rejects directory traversal attempts', async t => {
	const validator = goToDefinitionTool.validator;
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

test('go_to_definition validator: rejects non-existent files', async t => {
	const validator = goToDefinitionTool.validator;
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

test('go_to_definition validator: rejects line numbers < 1', async t => {
	const validator = goToDefinitionTool.validator;
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
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /Line must be >= 1/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('go_to_definition validator: rejects character numbers < 1', async t => {
	const validator = goToDefinitionTool.validator;
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
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /Character must be >= 1/i);
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('go_to_definition validator: accepts valid parameters', async t => {
	const validator = goToDefinitionTool.validator;
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
		});

		t.true(result.valid);
	} finally {
		process.chdir(originalCwd);
	}
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('go_to_definition formatter: renders without result', async t => {
	const formatter = goToDefinitionTool.formatter;
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

test('go_to_definition formatter: renders with single definition', async t => {
	const formatter = goToDefinitionTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result = 'Found 1 definition:\n\nsrc/utils.ts:5:0\n  export function helper() {';

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

test('go_to_definition formatter: renders with multiple definitions', async t => {
	const formatter = goToDefinitionTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result =
		'Found 2 definitions:\n\nsrc/app.ts:5:0\n  function foo() {}\n\nsrc/types.ts:10:0\n  function foo() {}';

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

test('go_to_definition formatter: renders with no definition found', async t => {
	const formatter = goToDefinitionTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result = 'No definition found for symbol at src/app.ts:10:5';

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

test('go_to_definition formatter: displays language for Python files', async t => {
	const formatter = goToDefinitionTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result = 'Found 1 definition:\n\nsrc/utils.py:10:0';

	const element = formatter(
		{
			path: 'src/app.py',
			line: 10,
			character: 5,
		},
		result,
	);

	t.truthy(element);
});

test('go_to_definition tool: has correct tool name', t => {
	t.is(goToDefinitionTool.name, 'lsp_go_to_definition');
});

test('go_to_definition tool: has needsApproval function', t => {
	t.is(typeof goToDefinitionTool.tool.needsApproval, 'function');
});
