import {existsSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../../config/themes';
import {ThemeContext} from '../../hooks/useTheme';
import {createDirectoryTool} from './create-directory';

console.log(`\ncreate-directory.spec.tsx – ${React.version}`);

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

test('create_directory tool has correct name', t => {
	t.is(createDirectoryTool.name, 'create_directory');
});

test('create_directory does not require approval', t => {
	t.is(createDirectoryTool.tool.needsApproval, false);
});

test('create_directory tool has handler function', t => {
	t.is(typeof createDirectoryTool.tool.execute, 'function');
});

test('create_directory tool has formatter function', t => {
	t.is(typeof createDirectoryTool.formatter, 'function');
});

// ============================================================================
// Formatter
// ============================================================================

test('create_directory formatter renders path', t => {
	const formatter = createDirectoryTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{path: 'src/new-dir'},
		'Directory created: src/new-dir',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /create_directory/);
	t.regex(output!, /src\/new-dir/);
});

// ============================================================================
// Validator
// ============================================================================

test.serial('create_directory validator rejects path traversal', async t => {
	const validator = createDirectoryTool.validator;
	if (!validator) {
		t.fail('Validator is not defined');
		return;
	}

	const result = await validator({path: '../outside'});
	t.false(result.valid);
});

// ============================================================================
// Execution
// ============================================================================

test.serial('create_directory creates a nested directory', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-create-dir-temp');

	try {
		mkdirSync(testDir, {recursive: true});

		const originalCwd = process.cwd();
		try {
			process.chdir(testDir);

			const result = await createDirectoryTool.tool.execute!(
				{path: 'a/b/c'},
				{toolCallId: 'test', messages: []},
			);

			t.regex(result, /Directory created/);
			t.true(existsSync(join(testDir, 'a', 'b', 'c')), 'Directory should exist');
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'create_directory is idempotent for existing directory',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-create-dir-idempotent-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			mkdirSync(join(testDir, 'existing'), {recursive: true});

			const originalCwd = process.cwd();
			try {
				process.chdir(testDir);

				const result = await createDirectoryTool.tool.execute!(
					{path: 'existing'},
					{toolCallId: 'test', messages: []},
				);

				t.regex(result, /already exists/);
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);
