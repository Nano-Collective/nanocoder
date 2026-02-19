import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../../config/themes';
import {ThemeContext} from '../../hooks/useTheme';
import {copyFileTool} from './copy-file';

console.log(`\ncopy-file.spec.tsx – ${React.version}`);

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

test('copy_file tool has correct name', t => {
	t.is(copyFileTool.name, 'copy_file');
});

test('copy_file has function-based approval', t => {
	t.is(typeof copyFileTool.tool.needsApproval, 'function');
});

test('copy_file tool has handler function', t => {
	t.is(typeof copyFileTool.tool.execute, 'function');
});

test('copy_file tool has formatter function', t => {
	t.is(typeof copyFileTool.formatter, 'function');
});

// ============================================================================
// Formatter
// ============================================================================

test('copy_file formatter renders source and destination', t => {
	const formatter = copyFileTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{source: 'a.ts', destination: 'b.ts'},
		'File copied: a.ts → b.ts',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /copy_file/);
	t.regex(output!, /a\.ts/);
	t.regex(output!, /b\.ts/);
});

// ============================================================================
// Validator
// ============================================================================

test.serial('copy_file validator rejects path traversal in source', async t => {
	const validator = copyFileTool.validator;
	if (!validator) {
		t.fail('Validator is not defined');
		return;
	}

	const result = await validator({
		source: '../etc/passwd',
		destination: 'file.ts',
	});
	t.false(result.valid);
});

test.serial(
	'copy_file validator rejects path traversal in destination',
	async t => {
		const validator = copyFileTool.validator;
		if (!validator) {
			t.fail('Validator is not defined');
			return;
		}

		const result = await validator({
			source: 'file.ts',
			destination: '../etc/passwd',
		});
		t.false(result.valid);
	},
);

test.serial('copy_file validator rejects non-existent source', async t => {
	const validator = copyFileTool.validator;
	if (!validator) {
		t.fail('Validator is not defined');
		return;
	}

	const result = await validator({
		source: 'definitely-does-not-exist-12345.ts',
		destination: 'new.ts',
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /does not exist/);
	}
});

// ============================================================================
// Execution
// ============================================================================

test.serial('copy_file copies a file', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-copy-file-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'source.ts'), 'const x = 1;');

		const originalCwd = process.cwd();
		try {
			process.chdir(testDir);

			const result = await copyFileTool.tool.execute!(
				{source: 'source.ts', destination: 'copy.ts'},
				{toolCallId: 'test', messages: []},
			);

			t.regex(result, /File copied/);
			t.true(
				existsSync(join(testDir, 'source.ts')),
				'Source should still exist',
			);
			t.true(
				existsSync(join(testDir, 'copy.ts')),
				'Copy should exist',
			);
			t.is(readFileSync(join(testDir, 'copy.ts'), 'utf-8'), 'const x = 1;');
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});
