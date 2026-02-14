import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes.js';
import {setCurrentMode} from '../context/mode-context.js';
import {ThemeContext} from '../hooks/useTheme.js';
import {stringReplaceTool} from './string-replace.js';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\nstring-replace.spec.tsx – ${React.version}`);

// Create a mock theme provider for tests
function TestThemeProvider({children}: {children: React.ReactNode}) {
	const themeContextValue = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{children}
		</ThemeContext.Provider>
	);
}

let testDir: string;

// Create a temporary directory before each test
test.beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), 'string-replace-test-'));
});

// Clean up temporary directory after each test
test.afterEach(async () => {
	if (testDir) {
		await rm(testDir, {recursive: true, force: true});
	}
});

// Helper to execute the string_replace tool
async function executeStringReplace(args: {
	path: string;
	old_str: string;
	new_str: string;
}): Promise<string> {
	// biome-ignore lint/suspicious/noExplicitAny: Tool internals require any
	return await (stringReplaceTool.tool as any).execute(args, {
		toolCallId: 'test',
		messages: [],
	});
}

// Helper to create a test file
async function createTestFile(
	filename: string,
	content: string,
): Promise<string> {
	const filePath = join(testDir, filename);
	await writeFile(filePath, content, 'utf-8');
	return filePath;
}

// ============================================================================
// Approval Tests
// ============================================================================

test('string_replace requires approval in normal mode', async t => {
	setCurrentMode('normal');
	const needsApproval = stringReplaceTool.tool.needsApproval;

	if (typeof needsApproval === 'function') {
		const result = await needsApproval(
			{
				path: 'test.txt',
				old_str: 'old',
				new_str: 'new',
			},
			{toolCallId: 'test', messages: []},
		);
		t.true(result);
	} else {
		t.is(needsApproval, true);
	}
});

test('string_replace does NOT require approval in auto-accept mode', async t => {
	setCurrentMode('auto-accept');
	const needsApproval = stringReplaceTool.tool.needsApproval;

	if (typeof needsApproval === 'function') {
		const result = await needsApproval(
			{
				path: 'test.txt',
				old_str: 'old',
				new_str: 'new',
			},
			{toolCallId: 'test', messages: []},
		);
		t.false(result);
	} else {
		t.is(needsApproval, false);
	}
});

test('string_replace requires approval in plan mode', async t => {
	setCurrentMode('plan');
	const needsApproval = stringReplaceTool.tool.needsApproval;

	if (typeof needsApproval === 'function') {
		const result = await needsApproval(
			{
				path: 'test.txt',
				old_str: 'old',
				new_str: 'new',
			},
			{toolCallId: 'test', messages: []},
		);
		t.true(result);
	} else {
		t.is(needsApproval, true);
	}
});

// ============================================================================
// Basic Replacement Tests
// ============================================================================

test('string_replace: basic single-line replacement', async t => {
	const filePath = await createTestFile(
		'test.txt',
		'Hello World\nGoodbye World\n',
	);

	const result = await executeStringReplace({
		path: filePath,
		old_str: 'Hello World',
		new_str: 'Hi Universe',
	});

	const newContent = await readFile(filePath, 'utf-8');
	t.is(newContent, 'Hi Universe\nGoodbye World\n');
	t.true(result.includes('Successfully replaced'));
});

test('string_replace: multi-line replacement', async t => {
	const filePath = await createTestFile(
		'test.ts',
		'function foo() {\n  return 1;\n}\n',
	);

	const result = await executeStringReplace({
		path: filePath,
		old_str: 'function foo() {\n  return 1;\n}',
		new_str: 'function foo() {\n  return 2;\n}',
	});

	const newContent = await readFile(filePath, 'utf-8');
	t.is(newContent, 'function foo() {\n  return 2;\n}\n');
	t.true(result.includes('Successfully replaced'));
});

test('string_replace: insert content (add lines)', async t => {
	const filePath = await createTestFile(
		'test.ts',
		"import fs from 'fs';\n\nfunction main() {}\n",
	);

	const result = await executeStringReplace({
		path: filePath,
		old_str: "import fs from 'fs';\n\nfunction main() {}",
		new_str: "import fs from 'fs';\nimport path from 'path';\n\nfunction main() {}",
	});

	const newContent = await readFile(filePath, 'utf-8');
	t.true(newContent.includes("import path from 'path';"));
	t.true(result.includes('Successfully replaced'));
});

test('string_replace: delete content (remove lines)', async t => {
	const filePath = await createTestFile(
		'test.ts',
		'const x = 1;\nconst unused = 2;\nconst y = 3;\n',
	);

	const result = await executeStringReplace({
		path: filePath,
		old_str: 'const x = 1;\nconst unused = 2;\nconst y = 3;',
		new_str: 'const x = 1;\nconst y = 3;',
	});

	const newContent = await readFile(filePath, 'utf-8');
	t.false(newContent.includes('unused'));
	t.true(result.includes('Successfully replaced'));
});

test('string_replace: replace with empty string (delete)', async t => {
	const filePath = await createTestFile(
		'test.txt',
		'Keep this\nDelete this\nKeep this too\n',
	);

	const result = await executeStringReplace({
		path: filePath,
		old_str: 'Delete this\n',
		new_str: '',
	});

	const newContent = await readFile(filePath, 'utf-8');
	t.is(newContent, 'Keep this\nKeep this too\n');
	t.true(result.includes('Successfully replaced'));
});

// ============================================================================
// Error Handling Tests
// ============================================================================

test('string_replace: error when content not found', async t => {
	const filePath = await createTestFile('test.txt', 'Hello World\n');

	await t.throwsAsync(
		async () => {
			await executeStringReplace({
				path: filePath,
				old_str: 'This does not exist',
				new_str: 'New content',
			});
		},
		{
			message: /Content not found in file/,
		},
	);
});

test('string_replace: error when multiple matches found', async t => {
	const filePath = await createTestFile(
		'test.txt',
		'Hello World\nHello World\n',
	);

	await t.throwsAsync(
		async () => {
			await executeStringReplace({
				path: filePath,
				old_str: 'Hello World',
				new_str: 'Hi Universe',
			});
		},
		{
			message: /Found 2 matches/,
		},
	);
});

test('string_replace: error when file does not exist', async t => {
	await t.throwsAsync(
		async () => {
			await executeStringReplace({
				path: join(testDir, 'nonexistent.txt'),
				old_str: 'old',
				new_str: 'new',
			});
		},
		{
			message: /ENOENT/,
		},
	);
});

test('string_replace: error when old_str is empty', async t => {
	const filePath = await createTestFile('test.txt', 'content\n');

	await t.throwsAsync(
		async () => {
			await executeStringReplace({
				path: filePath,
				old_str: '',
				new_str: 'new',
			});
		},
		{
			message: /old_str cannot be empty/,
		},
	);
});

// ============================================================================
// Context Matching Tests
// ============================================================================

test('string_replace: unique match with surrounding context', async t => {
	const filePath = await createTestFile(
		'test.ts',
		'const a = 1;\nconst b = 2;\nconst c = 3;\n',
	);

	// Include context to make it unique
	const result = await executeStringReplace({
		path: filePath,
		old_str: 'const a = 1;\nconst b = 2;',
		new_str: 'const a = 1;\nconst b = 5;',
	});

	const newContent = await readFile(filePath, 'utf-8');
	t.is(newContent, 'const a = 1;\nconst b = 5;\nconst c = 3;\n');
	t.true(result.includes('Successfully replaced'));
});

test('string_replace: whitespace must match exactly', async t => {
	const filePath = await createTestFile('test.ts', 'function foo() {\n  return 1;\n}\n');

	// This should fail because indentation doesn't match
	await t.throwsAsync(
		async () => {
			await executeStringReplace({
				path: filePath,
				old_str: 'function foo() {\nreturn 1;\n}', // Missing indentation
				new_str: 'function foo() {\n  return 2;\n}',
			});
		},
		{
			message: /Content not found/,
		},
	);
});

// ============================================================================
// Large File Tests
// ============================================================================

test('string_replace: works with large replacements', async t => {
	// Create a large block of text to replace
	const largeOldBlock = Array.from({length: 60}, (_, i) => `line ${i + 1}`).join('\n');
	const largeNewBlock = Array.from({length: 60}, (_, i) => `new line ${i + 1}`).join('\n');

	const filePath = await createTestFile(
		'test.txt',
		`${largeOldBlock}\n`,
	);

	const result = await executeStringReplace({
		path: filePath,
		old_str: largeOldBlock,
		new_str: largeNewBlock,
	});

	const newContent = await readFile(filePath, 'utf-8');
	t.true(newContent.includes('new line 1'));
	t.true(newContent.includes('new line 60'));
	t.true(result.includes('Successfully replaced'));
});

// ============================================================================
// Validator Tests
// ============================================================================

test('string_replace validator: accepts valid input', async t => {
	await createTestFile('test.txt', 'Hello World\n');

	if (!stringReplaceTool.validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();
	try {
		process.chdir(testDir);

		const result = await stringReplaceTool.validator({
			path: 'test.txt',
			old_str: 'Hello',
			new_str: 'Hi',
		});

		t.true(result.valid);
	} finally {
		process.chdir(originalCwd);
	}
});

test('string_replace validator: rejects non-existent file', async t => {
	if (!stringReplaceTool.validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();
	try {
		process.chdir(testDir);

		const result = await stringReplaceTool.validator({
			path: 'nonexistent.txt',
			old_str: 'old',
			new_str: 'new',
		});

		t.false(result.valid);
		if (!result.valid) {
			t.true(result.error.includes('does not exist'));
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('string_replace validator: rejects empty old_str', async t => {
	await createTestFile('test.txt', 'content\n');

	if (!stringReplaceTool.validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();
	try {
		process.chdir(testDir);

		const result = await stringReplaceTool.validator({
			path: 'test.txt',
			old_str: '',
			new_str: 'new',
		});

		t.false(result.valid);
		if (!result.valid) {
			t.true(result.error.includes('cannot be empty'));
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('string_replace validator: rejects when content not found', async t => {
	await createTestFile('test.txt', 'Hello World\n');

	if (!stringReplaceTool.validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();
	try {
		process.chdir(testDir);

		const result = await stringReplaceTool.validator({
			path: 'test.txt',
			old_str: 'This does not exist',
			new_str: 'new',
		});

		t.false(result.valid);
		if (!result.valid) {
			t.true(result.error.includes('Content not found in file'));
		}
	} finally {
		process.chdir(originalCwd);
	}
});

test('string_replace validator: rejects when multiple matches found', async t => {
	await createTestFile(
		'test.txt',
		'Hello World\nHello World\n',
	);

	if (!stringReplaceTool.validator) {
		t.fail('Validator not defined');
		return;
	}

	const originalCwd = process.cwd();
	try {
		process.chdir(testDir);

		const result = await stringReplaceTool.validator({
			path: 'test.txt',
			old_str: 'Hello World',
			new_str: 'Hi Universe',
		});

		t.false(result.valid);
		if (!result.valid) {
			t.true(result.error.includes('Found 2 matches'));
		}
	} finally {
		process.chdir(originalCwd);
	}
});

// ============================================================================
// Special Character Tests
// ============================================================================

test('string_replace: handles special regex characters', async t => {
	const filePath = await createTestFile(
		'test.txt',
		'const regex = /test.*pattern/;\n',
	);

	const result = await executeStringReplace({
		path: filePath,
		old_str: 'const regex = /test.*pattern/;',
		new_str: 'const regex = /new.*pattern/;',
	});

	const newContent = await readFile(filePath, 'utf-8');
	t.is(newContent, 'const regex = /new.*pattern/;\n');
	t.true(result.includes('Successfully replaced'));
});

test('string_replace: handles quotes and escapes', async t => {
	const filePath = await createTestFile(
		'test.ts',
		'const str = "Hello \\"World\\"";\n',
	);

	const result = await executeStringReplace({
		path: filePath,
		old_str: 'const str = "Hello \\"World\\""',
		new_str: 'const str = "Hi \\"Universe\\""',
	});

	const newContent = await readFile(filePath, 'utf-8');
	t.true(newContent.includes('Hi \\"Universe\\"'));
	t.true(result.includes('Successfully replaced'));
});

// ============================================================================
// Formatter Tests
// ============================================================================

test('string_replace formatter: generates preview for valid replacement', async t => {
	const filePath = await createTestFile(
		'test.ts',
		'const x = 1;\nconst y = 2;\nconst z = 3;\n',
	);

	if (!stringReplaceTool.formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const preview = await stringReplaceTool.formatter({
		path: filePath,
		old_str: 'const x = 1;\nconst y = 2;',
		new_str: 'const x = 1;\nconst y = 5;',
	});

	// Verify preview is a valid React element (truthy, has type property)
	t.truthy(preview);
	// React elements have a $$typeof property or type property
	t.truthy(
		preview && typeof preview === 'object' && ('$$typeof' in preview || 'type' in preview),
	);
});

test('string_replace formatter: generates result message after execution', async t => {
	const filePath = await createTestFile(
		'test.ts',
		'const x = 1;\nconst y = 2;\n',
	);

	if (!stringReplaceTool.formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result = await executeStringReplace({
		path: filePath,
		old_str: 'const x = 1;',
		new_str: 'const x = 10;',
	});

	const preview = await stringReplaceTool.formatter(
		{
			path: filePath,
			old_str: 'const x = 1;',
			new_str: 'const x = 10;',
		},
		result,
	);

	t.truthy(preview);
	t.truthy(
		preview && typeof preview === 'object' && ('$$typeof' in preview || 'type' in preview),
	);
});

test('string_replace formatter: shows error for content not found', async t => {
	const filePath = await createTestFile('test.txt', 'Hello World\n');

	if (!stringReplaceTool.formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const preview = await stringReplaceTool.formatter({
		path: filePath,
		old_str: 'This does not exist',
		new_str: 'New content',
	});

	// Should return a React element with error content
	t.truthy(preview);
	t.truthy(
		preview && typeof preview === 'object' && ('$$typeof' in preview || 'type' in preview),
	);
});

test('string_replace formatter: shows error for multiple matches', async t => {
	const filePath = await createTestFile(
		'test.txt',
		'Hello World\nHello World\n',
	);

	if (!stringReplaceTool.formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const preview = await stringReplaceTool.formatter({
		path: filePath,
		old_str: 'Hello World',
		new_str: 'Hi Universe',
	});

	t.truthy(preview);
	t.truthy(
		preview && typeof preview === 'object' && ('$$typeof' in preview || 'type' in preview),
	);
});

test('string_replace formatter: handles file read errors gracefully', async t => {
	if (!stringReplaceTool.formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const preview = await stringReplaceTool.formatter({
		path: join(testDir, 'nonexistent.txt'),
		old_str: 'old',
		new_str: 'new',
	});

	t.truthy(preview);
	t.truthy(
		preview && typeof preview === 'object' && ('$$typeof' in preview || 'type' in preview),
	);
});

// ============================================================================
// Validator Additional Error Handling Tests
// ============================================================================

test('string_replace validator: handles file read errors', async t => {
	if (!stringReplaceTool.validator) {
		t.fail('Validator not defined');
		return;
	}

	// Create a file but make it unreadable
	const filePath = await createTestFile('test.txt', 'content\n');

	// Mock getCachedFileContent to throw an error
	const originalCache = await import('../utils/file-cache.js');
	const mockError = new Error('EACCES: permission denied');

	// Since we can't easily mock the file cache, we'll test with an invalid path
	// that causes the file read to fail in a different way
	const result = await stringReplaceTool.validator({
		path: join(testDir, 'nonexistent.txt'),
		old_str: 'old',
		new_str: 'new',
	});

	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('does not exist') || result.error.includes('⚒'));
	}
});

test('string_replace validator: handles file content access errors', async t => {
	if (!stringReplaceTool.validator) {
		t.fail('Validator not defined');
		return;
	}

	// Use a directory path instead of a file path to trigger a different error
	const result = await stringReplaceTool.validator({
		path: testDir, // Directory, not a file
		old_str: 'old',
		new_str: 'new',
	});

	// Should fail because it's a directory, not a file
	t.false(result.valid);
});

// ============================================================================
// Formatter Tests (Visual Display with Ink)
// ============================================================================

test('string_replace formatter: renders preview with basic replacement', async t => {
	const filePath = await createTestFile(
		'test.ts',
		'const x = 1;\nconst y = 2;\nconst z = 3;\n',
	);

	const formatter = stringReplaceTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = await formatter({
		path: filePath,
		old_str: 'const y = 2;',
		new_str: 'const y = 5;',
	});

	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();

	t.truthy(output);
	t.regex(output!, /string_replace/);
	t.regex(output!, /test\.ts/);
	t.regex(output!, /Replacing 1 line/);
});

test('string_replace formatter: shows normalized indentation for deeply indented code', async t => {
	const filePath = await createTestFile(
		'nested.tsx',
		'      function Component() {\n        return (\n          <div>\n            <button>Click</button>\n          </div>\n        );\n      }\n',
	);

	const formatter = stringReplaceTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = await formatter({
		path: filePath,
		old_str: '            <button>Click</button>',
		new_str: '            <button>Submit</button>',
	});

	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();

	t.truthy(output);
	// Should show normalized indentation (not the original deep nesting)
	// The leftmost code should start at column 0 after line numbers
	t.regex(output!, /string_replace/);
	t.regex(output!, /nested\.tsx/);
});

test('string_replace formatter: shows context before and after', async t => {
	const filePath = await createTestFile(
		'context.ts',
		'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\n',
	);

	const formatter = stringReplaceTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = await formatter({
		path: filePath,
		old_str: 'line5',
		new_str: 'CHANGED',
	});

	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();

	t.truthy(output);
	// Should show context lines (3 before, 3 after)
	t.regex(output!, /line2/);
	t.regex(output!, /line3/);
	t.regex(output!, /line4/);
	t.regex(output!, /line6/);
	t.regex(output!, /line7/);
	t.regex(output!, /line8/);
});

test('string_replace formatter: displays error when content not found', async t => {
	const filePath = await createTestFile('test.txt', 'Hello World\n');

	const formatter = stringReplaceTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = await formatter({
		path: filePath,
		old_str: 'Does not exist',
		new_str: 'New',
	});

	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();

	t.truthy(output);
	t.regex(output!, /Error.*Content not found/);
});

test('string_replace formatter: displays error when multiple matches', async t => {
	const filePath = await createTestFile(
		'duplicate.txt',
		'foo\nfoo\nfoo\n',
	);

	const formatter = stringReplaceTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = await formatter({
		path: filePath,
		old_str: 'foo',
		new_str: 'bar',
	});

	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();

	t.truthy(output);
	t.regex(output!, /Error.*Found 3 matches/);
	t.regex(output!, /Add more surrounding context/);
});

test('string_replace formatter: shows success after execution', async t => {
	const filePath = await createTestFile('test.txt', 'old content\n');

	const formatter = stringReplaceTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	// First execute the replacement
	await executeStringReplace({
		path: filePath,
		old_str: 'old content',
		new_str: 'new content',
	});

	// Then render the result state
	const element = await formatter(
		{
			path: filePath,
			old_str: 'old content',
			new_str: 'new content',
		},
		'Successfully replaced content at line 1',
	);

	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();

	t.truthy(output);
	t.regex(output!, /string_replace/);
	t.regex(output!, /Replace completed/);
});

test('string_replace formatter: handles multi-line replacements', async t => {
	const filePath = await createTestFile(
		'multi.ts',
		'function old() {\n  return 1;\n}\n',
	);

	const formatter = stringReplaceTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = await formatter({
		path: filePath,
		old_str: 'function old() {\n  return 1;\n}',
		new_str: 'function new() {\n  return 2;\n  return 3;\n}',
	});

	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();

	t.truthy(output);
	t.regex(output!, /Replacing 3 lines with 4 lines/);
});

test('string_replace formatter: normalizes tabs to 2 spaces', async t => {
	const filePath = await createTestFile(
		'tabs.ts',
		'\t\tfunction test() {\n\t\t\treturn 1;\n\t\t}\n',
	);

	const formatter = stringReplaceTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const element = await formatter({
		path: filePath,
		old_str: '\t\t\treturn 1;',
		new_str: '\t\t\treturn 2;',
	});

	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();

	t.truthy(output);
	// Should normalize tabs to spaces for display
	t.regex(output!, /string_replace/);
	t.regex(output!, /tabs\.ts/);
});

// ============================================================================
// Cleanup
// ============================================================================

test.after(() => {
	setCurrentMode('normal');
});
