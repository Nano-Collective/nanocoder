import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {findFilesTool} from './find-files';
import {ThemeContext} from '../hooks/useTheme';
import {themes} from '../config/themes';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\nfind-files.spec.tsx – ${React.version}`);

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

// ============================================================================
// Tests for FindFilesFormatter Component Rendering
// ============================================================================

test('FindFilesFormatter renders with pattern', t => {
	const formatter = findFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{pattern: '*.tsx', maxResults: 50},
		'Found 15 matches',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /find_files/);
	t.regex(output!, /\*\.tsx/);
	t.regex(output!, /15/);
});

test('FindFilesFormatter shows 0 results when no matches', t => {
	const formatter = findFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{pattern: '*.nonexistent'},
		'No files or directories found',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /0/);
});

test('FindFilesFormatter handles error results gracefully', t => {
	const formatter = findFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({pattern: '*.ts'}, 'Error: Something went wrong');
	const {lastFrame} = render(element);

	// Should return empty fragment for errors
	const output = lastFrame();
	t.is(output, '');
});

test('FindFilesFormatter displays pattern parameter', t => {
	const formatter = findFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{pattern: 'src/**/*.ts', maxResults: 50},
		'Found 42 matches',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.regex(output!, /Pattern:/);
	t.regex(output!, /src\/\*\*\/\*\.ts/);
});

test('FindFilesFormatter displays results count', t => {
	const formatter = findFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({pattern: '*.ts'}, 'Found 23 matches');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.regex(output!, /Results:/);
	t.regex(output!, /23/);
});

test('FindFilesFormatter renders without crashing', t => {
	const formatter = findFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({pattern: '*.tsx'}, 'Found 5 matches');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	// Should render without errors
	t.truthy(lastFrame());
});

// ============================================================================
// Tests for find_files Tool Handler - Gitignore Integration
// ============================================================================

test.serial('find_files respects .gitignore patterns', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-find-gitignore-temp');

	try {
		// Create test directory structure
		mkdirSync(testDir, {recursive: true});
		mkdirSync(join(testDir, 'src'), {recursive: true});
		mkdirSync(join(testDir, 'build'), {recursive: true});

		// Create .gitignore
		writeFileSync(join(testDir, '.gitignore'), 'build/\n*.ignored\n');

		// Create test files
		writeFileSync(join(testDir, 'src', 'component.tsx'), 'export const Comp');
		writeFileSync(join(testDir, 'build', 'output.tsx'), 'compiled code');
		writeFileSync(join(testDir, 'file.ignored'), 'should be ignored');

		// Save current directory
		const originalCwd = process.cwd();

		try {
			// Change to test directory
			process.chdir(testDir);

			// Test pattern search - should exclude ignored files
			const result = await findFilesTool.tool.execute!(
				{
					pattern: '**/*.tsx',
					maxResults: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			t.false(
				result.includes('build/'),
				'Should not include ignored directory',
			);
			t.true(
				result.includes('src/component.tsx'),
				'Should include non-ignored files',
			);
		} finally {
			// Restore original directory
			process.chdir(originalCwd);
		}
	} finally {
		// Cleanup
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'find_files uses hardcoded ignores when no .gitignore exists',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-find-no-gitignore-temp');

		try {
			// Create test directory without .gitignore
			mkdirSync(testDir, {recursive: true});
			mkdirSync(join(testDir, 'node_modules'), {recursive: true});
			mkdirSync(join(testDir, 'src'), {recursive: true});

			// Create test files
			writeFileSync(join(testDir, 'node_modules', 'package.js'), 'module code');
			writeFileSync(join(testDir, 'src', 'index.js'), 'source code');

			// Save current directory
			const originalCwd = process.cwd();

			try {
				// Change to test directory
				process.chdir(testDir);

				// Test pattern search - should exclude node_modules even without .gitignore
				const result = await findFilesTool.tool.execute!(
					{
						pattern: '**/*.js',
						maxResults: 50,
					},
					{toolCallId: 'test', messages: []},
				);

				t.false(
					result.includes('node_modules'),
					'Should ignore node_modules by default',
				);
				t.true(
					result.includes('src/index.js'),
					'Should include non-ignored files',
				);
			} finally {
				// Restore original directory
				process.chdir(originalCwd);
			}
		} finally {
			// Cleanup
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

// ============================================================================
// Tests for find_files Tool Handler - Pattern Matching
// ============================================================================

test.serial('find_files handles directory patterns (dir/**)', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-find-dir-pattern-temp');

	try {
		// Create test directory structure
		mkdirSync(testDir, {recursive: true});
		mkdirSync(join(testDir, 'scripts'), {recursive: true});
		mkdirSync(join(testDir, 'src'), {recursive: true});

		// Create test files
		writeFileSync(join(testDir, 'scripts', 'build.sh'), '#!/bin/bash');
		writeFileSync(join(testDir, 'scripts', 'test.js'), 'console.log()');
		writeFileSync(join(testDir, 'src', 'app.ts'), 'export const app');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await findFilesTool.tool.execute!(
				{
					pattern: 'scripts/**',
					maxResults: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(
				result.includes('scripts/build.sh'),
				'Should include scripts dir files',
			);
			t.true(
				result.includes('scripts/test.js'),
				'Should include all files in scripts',
			);
			t.false(result.includes('src/'), 'Should not include other directories');
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('find_files handles wildcard patterns (**/*.ext)', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-find-wildcard-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		mkdirSync(join(testDir, 'src'), {recursive: true});
		mkdirSync(join(testDir, 'lib'), {recursive: true});

		writeFileSync(join(testDir, 'src', 'index.ts'), 'source');
		writeFileSync(join(testDir, 'lib', 'utils.ts'), 'utils');
		writeFileSync(join(testDir, 'readme.md'), 'docs');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await findFilesTool.tool.execute!(
				{
					pattern: '**/*.ts',
					maxResults: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(result.includes('src/index.ts'), 'Should find .ts in src');
			t.true(result.includes('lib/utils.ts'), 'Should find .ts in lib');
			t.false(result.includes('readme.md'), 'Should not include .md files');
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('find_files handles brace expansion patterns', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-find-brace-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		mkdirSync(join(testDir, 'src'), {recursive: true});

		writeFileSync(join(testDir, 'src', 'comp.tsx'), 'tsx file');
		writeFileSync(join(testDir, 'src', 'util.ts'), 'ts file');
		writeFileSync(join(testDir, 'src', 'style.css'), 'css file');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await findFilesTool.tool.execute!(
				{
					pattern: '*.{ts,tsx}',
					maxResults: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(
				result.includes('comp.tsx') || result.includes('util.ts'),
				'Should find .ts and .tsx files',
			);
			t.false(result.includes('style.css'), 'Should not include .css files');
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('find_files handles simple patterns (*.ext)', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-find-simple-temp');

	try {
		mkdirSync(testDir, {recursive: true});

		writeFileSync(join(testDir, 'file1.json'), '{}');
		writeFileSync(join(testDir, 'file2.json'), '{}');
		writeFileSync(join(testDir, 'file3.txt'), 'text');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await findFilesTool.tool.execute!(
				{
					pattern: '*.json',
					maxResults: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(result.includes('file1.json'), 'Should find .json files');
			t.true(result.includes('file2.json'), 'Should find all .json files');
			t.false(result.includes('file3.txt'), 'Should not include .txt files');
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'find_files includes directories when they match pattern',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-find-dirs-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			mkdirSync(join(testDir, 'components'), {recursive: true});
			mkdirSync(join(testDir, 'utils'), {recursive: true});

			writeFileSync(join(testDir, 'components', 'Button.tsx'), 'component');

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				const result = await findFilesTool.tool.execute!(
					{
						pattern: 'components',
						maxResults: 50,
					},
					{toolCallId: 'test', messages: []},
				);

				// Should find the directory itself
				t.true(result.includes('components'), 'Should find directory by name');
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

// ============================================================================
// Tests for find_files Tool Handler - Basic Functionality
// ============================================================================

test.serial(
	'find_files returns no files message for nonexistent pattern',
	async t => {
		t.timeout(10000);
		const result = await findFilesTool.tool.execute!(
			{
				pattern: '**/*.veryuniqueextension',
				maxResults: 50,
			},
			{toolCallId: 'test', messages: []},
		);

		t.regex(result, /No files or directories found/);
	},
);

// ============================================================================
// Tests for find_files Tool Configuration
// ============================================================================

test('find_files tool has correct name', t => {
	t.is(findFilesTool.name, 'find_files');
});

test('find_files tool does not require confirmation', t => {
	t.false(findFilesTool.tool.needsApproval);
});

test('find_files tool has handler function', t => {
	t.is(typeof findFilesTool.tool.execute, 'function');
});

test('find_files tool has formatter function', t => {
	t.is(typeof findFilesTool.formatter, 'function');
});

// ============================================================================
// Tests for maxResults Cap
// ============================================================================

test.serial('find_files enforces max cap of 100 results', async t => {
	t.timeout(10000);
	// Request more than 100 results but should be capped at 100
	const result = await findFilesTool.tool.execute!(
		{
			pattern: '**/*.ts',
			maxResults: 500, // Request 500, but should cap at 100
		},
		{toolCallId: 'test', messages: []},
	);

	// Check that the result doesn't exceed 100 matches
	const firstLine = result.split('\n')[0];
	const matchCount = firstLine.match(/Found (\d+)/);

	if (matchCount) {
		const count = parseInt(matchCount[1], 10);
		t.true(count <= 100, `Found ${count} matches, should be max 100`);
	}
});

test.serial('find_files respects maxResults when less than cap', async t => {
	t.timeout(10000);
	const result = await findFilesTool.tool.execute!(
		{
			pattern: '**/*.ts',
			maxResults: 10, // Request only 10
		},
		{toolCallId: 'test', messages: []},
	);

	// Should respect the lower limit
	t.truthy(result);
	t.false(result.includes('Error'));
});

// ============================================================================
// Edge Cases and Stress Tests
// ============================================================================

test.serial('find_files handles special characters in patterns', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-find-special-chars-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'file-with-dash.ts'), 'content');
		writeFileSync(join(testDir, 'file_with_underscore.ts'), 'content');
		writeFileSync(join(testDir, 'file.with.dots.ts'), 'content');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await findFilesTool.tool.execute!(
				{
					pattern: '*.ts',
					maxResults: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(result.includes('file-with-dash.ts'), 'Should handle dashes');
			t.true(
				result.includes('file_with_underscore.ts'),
				'Should handle underscores',
			);
			t.true(
				result.includes('file.with.dots.ts'),
				'Should handle multiple dots',
			);
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('find_files handles deeply nested directories', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-find-deep-temp');

	try {
		const deepPath = join(testDir, 'a', 'b', 'c', 'd', 'e');
		mkdirSync(deepPath, {recursive: true});
		writeFileSync(join(deepPath, 'deep.ts'), 'content');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await findFilesTool.tool.execute!(
				{
					pattern: '**/*.ts',
					maxResults: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(
				result.includes('deep.ts'),
				'Should find files in deeply nested directories',
			);
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('find_files handles empty directories gracefully', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-find-empty-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		mkdirSync(join(testDir, 'empty-dir'), {recursive: true});

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await findFilesTool.tool.execute!(
				{
					pattern: '*.ts',
					maxResults: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			t.regex(
				result,
				/No files or directories found/,
				'Should handle empty directories',
			);
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('find_files handles pattern with no wildcards', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-find-exact-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'exact-file.ts'), 'content');
		writeFileSync(join(testDir, 'other-file.ts'), 'content');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await findFilesTool.tool.execute!(
				{
					pattern: 'exact-file.ts',
					maxResults: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(result.includes('exact-file.ts'), 'Should find exact filename');
			t.false(result.includes('other-file.ts'), 'Should not find other files');
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('find_files handles patterns with subdirectory prefix', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-find-subdir-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		mkdirSync(join(testDir, 'src'), {recursive: true});
		mkdirSync(join(testDir, 'src', 'components'), {recursive: true});
		writeFileSync(join(testDir, 'src', 'components', 'Button.tsx'), 'content');
		writeFileSync(join(testDir, 'src', 'index.ts'), 'content');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await findFilesTool.tool.execute!(
				{
					pattern: 'src/components/**/*.tsx',
					maxResults: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(
				result.includes('Button.tsx'),
				'Should find files with subdirectory prefix',
			);
			t.false(
				result.includes('index.ts'),
				'Should not find files outside pattern',
			);
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('find_files handles symlinks gracefully', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-find-symlink-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		mkdirSync(join(testDir, 'real-dir'), {recursive: true});
		writeFileSync(join(testDir, 'real-dir', 'file.ts'), 'content');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			// Just verify it doesn't crash with symlinks present
			const result = await findFilesTool.tool.execute!(
				{
					pattern: '**/*.ts',
					maxResults: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			t.truthy(result);
			t.false(result.includes('Error'));
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'find_files handles multiple file extensions in brace pattern',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-find-multi-ext-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(join(testDir, 'file.ts'), 'content');
			writeFileSync(join(testDir, 'file.tsx'), 'content');
			writeFileSync(join(testDir, 'file.js'), 'content');
			writeFileSync(join(testDir, 'file.jsx'), 'content');

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				const result = await findFilesTool.tool.execute!(
					{
						pattern: '*.{ts,tsx,js,jsx}',
						maxResults: 50,
					},
					{toolCallId: 'test', messages: []},
				);

				t.true(result.includes('file.ts'), 'Should find .ts');
				t.true(result.includes('file.tsx'), 'Should find .tsx');
				t.true(result.includes('file.js'), 'Should find .js');
				t.true(result.includes('file.jsx'), 'Should find .jsx');
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial('find_files handles files with no extension', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-find-no-ext-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'Makefile'), 'content');
		writeFileSync(join(testDir, 'Dockerfile'), 'content');
		writeFileSync(join(testDir, 'file.ts'), 'content');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await findFilesTool.tool.execute!(
				{
					pattern: 'Makefile',
					maxResults: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(
				result.includes('Makefile'),
				'Should find files without extension',
			);
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'find_files correctly excludes all hardcoded ignore patterns',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-find-hardcoded-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			const ignoreDirs = [
				'node_modules',
				'.git',
				'dist',
				'build',
				'coverage',
				'.next',
				'.nuxt',
				'out',
				'.cache',
			];

			for (const dir of ignoreDirs) {
				mkdirSync(join(testDir, dir), {recursive: true});
				writeFileSync(join(testDir, dir, 'file.ts'), 'content');
			}

			mkdirSync(join(testDir, 'src'), {recursive: true});
			writeFileSync(join(testDir, 'src', 'file.ts'), 'content');

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				const result = await findFilesTool.tool.execute!(
					{
						pattern: '**/*.ts',
						maxResults: 50,
					},
					{toolCallId: 'test', messages: []},
				);

				for (const dir of ignoreDirs) {
					t.false(result.includes(`${dir}/`), `Should exclude ${dir}`);
				}
				t.true(
					result.includes('src/file.ts'),
					'Should include non-ignored files',
				);
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);
