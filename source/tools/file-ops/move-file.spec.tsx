import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../../config/themes';
import {ThemeContext} from '../../hooks/useTheme';
import {moveFileTool} from './move-file';

console.log(`\nmove-file.spec.tsx – ${React.version}`);

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

test('move_file tool has correct name', t => {
	t.is(moveFileTool.name, 'move_file');
});

test('move_file has function-based approval', t => {
	t.is(typeof moveFileTool.tool.needsApproval, 'function');
});

test('move_file tool has handler function', t => {
	t.is(typeof moveFileTool.tool.execute, 'function');
});

test('move_file tool has formatter function', t => {
	t.is(typeof moveFileTool.formatter, 'function');
});

// ============================================================================
// Formatter
// ============================================================================

test('move_file formatter renders source and destination', t => {
	const formatter = moveFileTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{source: 'old.ts', destination: 'new.ts'},
		'File moved: old.ts → new.ts',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /move_file/);
	t.regex(output!, /old\.ts/);
	t.regex(output!, /new\.ts/);
});

// ============================================================================
// Validator
// ============================================================================

test.serial('move_file validator rejects path traversal in source', async t => {
	const validator = moveFileTool.validator;
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
	'move_file validator rejects path traversal in destination',
	async t => {
		const validator = moveFileTool.validator;
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

test.serial('move_file validator rejects non-existent source', async t => {
	const validator = moveFileTool.validator;
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

test.serial('move_file moves a file', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-move-file-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'original.ts'), 'const x = 1;');

		const originalCwd = process.cwd();
		try {
			process.chdir(testDir);

			const result = await moveFileTool.tool.execute!(
				{source: 'original.ts', destination: 'renamed.ts'},
				{toolCallId: 'test', messages: []},
			);

			t.regex(result, /File moved/);
			t.false(existsSync(join(testDir, 'original.ts')), 'Source should be gone');
			t.true(
				existsSync(join(testDir, 'renamed.ts')),
				'Destination should exist',
			);
			t.is(
				readFileSync(join(testDir, 'renamed.ts'), 'utf-8'),
				'const x = 1;',
			);
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});
