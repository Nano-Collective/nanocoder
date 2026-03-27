import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../../config/themes';
import {ThemeContext} from '../../hooks/useTheme';
import {deleteFileTool} from './delete-file';

console.log(`\ndelete-file.spec.tsx – ${React.version}`);

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

// ============================================================================
// Tool Configuration
// ============================================================================

test('delete_file tool has correct name', t => {
	t.is(deleteFileTool.name, 'delete_file');
});

test('delete_file needsApproval is a function', t => {
	t.is(typeof deleteFileTool.tool.needsApproval, 'function');
});

test('delete_file tool has handler function', t => {
	t.is(typeof deleteFileTool.tool.execute, 'function');
});

test('delete_file tool has formatter function', t => {
	t.is(typeof deleteFileTool.formatter, 'function');
});

// ============================================================================
// Formatter
// ============================================================================

test('delete_file formatter renders path', t => {
	const formatter = deleteFileTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({path: 'src/old.ts'}, 'File deleted: src/old.ts');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /delete_file/);
	t.regex(output!, /src\/old\.ts/);
});

test('delete_file formatter truncates long path instead of wrapping', t => {
	const formatter = deleteFileTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const longPath =
		'source/very/deeply/nested/directory/structure/that/goes/on/and/on/to/exceed/the/terminal/width/for/testing/purposes/file.ts';
	const element = formatter({path: longPath}, `File deleted: ${longPath}`);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /delete_file/);
	// Path should be truncated — should not contain the full end of path
	t.false(
		output!.includes('purposes/file.ts'),
		'Long path should be truncated, not fully displayed',
	);
});

test('delete_file formatter does not truncate short path', t => {
	const formatter = deleteFileTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({path: 'src/file.ts'}, 'File deleted: src/file.ts');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /src\/file\.ts/);
});

// ============================================================================
// Validator
// ============================================================================

test.serial('delete_file validator rejects path traversal', async t => {
	const validator = deleteFileTool.validator;
	if (!validator) {
		t.fail('Validator is not defined');
		return;
	}

	const result = await validator({path: '../etc/passwd'});
	t.false(result.valid);
});

test.serial('delete_file validator rejects non-existent file', async t => {
	const validator = deleteFileTool.validator;
	if (!validator) {
		t.fail('Validator is not defined');
		return;
	}

	const result = await validator({path: 'definitely-does-not-exist-12345.ts'});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /does not exist/);
	}
});

// ============================================================================
// Execution
// ============================================================================

test.serial('delete_file deletes an existing file', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-delete-file-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		const filePath = join(testDir, 'to-delete.ts');
		writeFileSync(filePath, 'const x = 1;');

		const originalCwd = process.cwd();
		try {
			process.chdir(testDir);

			const result = await deleteFileTool.tool.execute!(
				{path: 'to-delete.ts'},
				{toolCallId: 'test', messages: []},
			);

			t.regex(result, /File deleted/);
			t.false(existsSync(filePath), 'File should be deleted');
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('delete_file rejects deleting a directory', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-delete-dir-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		mkdirSync(join(testDir, 'subdir'), {recursive: true});

		const originalCwd = process.cwd();
		try {
			process.chdir(testDir);

			const result = await deleteFileTool.tool.execute!(
				{path: 'subdir'},
				{toolCallId: 'test', messages: []},
			);

			t.regex(result, /is a directory/);
			t.true(existsSync(join(testDir, 'subdir')), 'Directory should still exist');
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});
