import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {searchFilesTool} from './search-files';
import {ThemeContext} from '../hooks/useTheme';
import {themes} from '../config/themes';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\nsearch-files.spec.tsx – ${React.version}`);

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
// Tests for SearchFilesFormatter Component Rendering
// ============================================================================

test('SearchFilesFormatter renders with query', t => {
	const formatter = searchFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{query: 'test query', maxResults: 50},
		'Found 5 matches',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /search_files/);
	t.regex(output!, /test query/);
	t.regex(output!, /5/);
});

test('SearchFilesFormatter renders with pattern', t => {
	const formatter = searchFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{pattern: '**/*.ts', maxResults: 50},
		'Found 10 files',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /search_files/);
	t.regex(output!, /\*\*\/\*\.ts/);
	t.regex(output!, /10/);
});

test('SearchFilesFormatter shows 0 results when no matches', t => {
	const formatter = searchFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({query: 'nonexistent'}, 'No matches found');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /0/);
});

test('SearchFilesFormatter handles error results gracefully', t => {
	const formatter = searchFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({query: 'test'}, 'Error: Something went wrong');
	const {lastFrame} = render(element);

	// Should return empty fragment for errors
	const output = lastFrame();
	t.is(output, '');
});

test('SearchFilesFormatter displays query parameter', t => {
	const formatter = searchFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{query: 'searchTerm', maxResults: 100},
		'Found 3 matches',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.regex(output!, /Query:/);
	t.regex(output!, /searchTerm/);
});

test('SearchFilesFormatter displays pattern parameter', t => {
	const formatter = searchFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{pattern: 'src/**/*.tsx', maxResults: 100},
		'Found 7 files',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.regex(output!, /Pattern:/);
	t.regex(output!, /src\/\*\*\/\*\.tsx/);
});

test('SearchFilesFormatter displays results count', t => {
	const formatter = searchFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({query: 'const'}, 'Found 42 matches');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.regex(output!, /Results:/);
	t.regex(output!, /42/);
});

test('SearchFilesFormatter renders without crashing', t => {
	const formatter = searchFilesTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({query: 'test'}, 'Found 1 matches');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	// Should render without errors
	t.truthy(lastFrame());
});

// ============================================================================
// Tests for search_files Tool Handler - Gitignore Integration
// ============================================================================

test.serial('search_files respects .gitignore for content search', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-gitignore-search-temp');

	try {
		// Create test directory structure
		mkdirSync(testDir, {recursive: true});
		mkdirSync(join(testDir, 'src'), {recursive: true});
		mkdirSync(join(testDir, 'ignored-dir'), {recursive: true});

		// Create .gitignore
		writeFileSync(join(testDir, '.gitignore'), 'ignored-dir/\n*.ignore.txt\n');

		// Create test files
		writeFileSync(
			join(testDir, 'src', 'test.ts'),
			'const testValue = "hello";',
		);
		writeFileSync(
			join(testDir, 'ignored-dir', 'ignored.ts'),
			'const ignoredValue = "world";',
		);
		writeFileSync(
			join(testDir, 'file.ignore.txt'),
			'const shouldBeIgnored = true;',
		);
		writeFileSync(join(testDir, 'normal.txt'), 'const normalFile = true;');

		// Save current directory
		const originalCwd = process.cwd();

		try {
			// Change to test directory
			process.chdir(testDir);

			// Test content search - should exclude ignored files
			const contentResult = await searchFilesTool.handler({
				query: 'const',
				maxResults: 50,
			});

			t.false(
				contentResult.includes('ignored-dir'),
				'Content search should not include ignored directory',
			);
			t.false(
				contentResult.includes('file.ignore.txt'),
				'Content search should not include ignored pattern',
			);
			t.true(
				contentResult.includes('src/test.ts') ||
					contentResult.includes('normal.txt'),
				'Content search should include non-ignored files',
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

test.serial('search_files respects .gitignore for pattern search', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-gitignore-pattern-temp');

	try {
		// Create test directory structure
		mkdirSync(testDir, {recursive: true});
		mkdirSync(join(testDir, 'src'), {recursive: true});
		mkdirSync(join(testDir, 'build'), {recursive: true});

		// Create .gitignore
		writeFileSync(join(testDir, '.gitignore'), 'build/\n');

		// Create test files
		writeFileSync(join(testDir, 'src', 'component.tsx'), 'export const Comp');
		writeFileSync(join(testDir, 'build', 'output.tsx'), 'compiled code');

		// Save current directory
		const originalCwd = process.cwd();

		try {
			// Change to test directory
			process.chdir(testDir);

			// Test pattern search - should exclude ignored files
			const patternResult = await searchFilesTool.handler({
				pattern: '**/*.tsx',
				maxResults: 50,
			});

			t.false(
				patternResult.includes('build/'),
				'Pattern search should not include ignored directory',
			);
			t.true(
				patternResult.includes('src/component.tsx'),
				'Pattern search should include non-ignored files',
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
	'search_files uses hardcoded ignores when no .gitignore exists',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-no-gitignore-temp');

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
				const patternResult = await searchFilesTool.handler({
					pattern: '**/*.js',
					maxResults: 50,
				});

				t.false(
					patternResult.includes('node_modules'),
					'Should ignore node_modules by default',
				);
				t.true(
					patternResult.includes('src/index.js'),
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

test.serial('search_files handles multiple .gitignore patterns', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-multi-ignore-temp');

	try {
		// Create test directory structure
		mkdirSync(testDir, {recursive: true});
		mkdirSync(join(testDir, 'src'), {recursive: true});
		mkdirSync(join(testDir, 'temp'), {recursive: true});
		mkdirSync(join(testDir, 'cache'), {recursive: true});

		// Create .gitignore with multiple patterns
		writeFileSync(join(testDir, '.gitignore'), 'temp/\ncache/\n*.tmp\n*.log\n');

		// Create test files
		writeFileSync(join(testDir, 'src', 'app.ts'), 'app code');
		writeFileSync(join(testDir, 'temp', 'file.ts'), 'temp file');
		writeFileSync(join(testDir, 'cache', 'data.ts'), 'cached data');
		writeFileSync(join(testDir, 'debug.log'), 'log content');
		writeFileSync(join(testDir, 'temp.tmp'), 'temporary');

		// Save current directory
		const originalCwd = process.cwd();

		try {
			// Change to test directory
			process.chdir(testDir);

			// Test pattern search
			const result = await searchFilesTool.handler({
				pattern: '**/*',
				maxResults: 50,
			});

			t.true(result.includes('src/app.ts'), 'Should include normal files');
			t.false(result.includes('temp/'), 'Should ignore temp directory');
			t.false(result.includes('cache/'), 'Should ignore cache directory');
			t.false(result.includes('debug.log'), 'Should ignore .log files');
			t.false(result.includes('temp.tmp'), 'Should ignore .tmp files');
		} finally {
			// Restore original directory
			process.chdir(originalCwd);
		}
	} finally {
		// Cleanup
		rmSync(testDir, {recursive: true, force: true});
	}
});

// ============================================================================
// Tests for search_files Tool Handler - Basic Functionality
// ============================================================================

test('search_files requires either query or pattern', async t => {
	await t.throwsAsync(
		async () => {
			await searchFilesTool.handler({maxResults: 50});
		},
		{
			message: /Either "query" or "pattern" must be provided/,
		},
	);
});

test.serial(
	'search_files handler returns no matches message for nonexistent query',
	async t => {
		t.timeout(10000);
		// Use a unique string that won't appear in source files
		const uniqueQuery = `zzz${Date.now()}nonexistent${Math.random()}`;
		const result = await searchFilesTool.handler({
			query: uniqueQuery,
			maxResults: 10,
		});

		t.regex(result, /No matches found/);
	},
);

test.serial(
	'search_files handler returns no files message for nonexistent pattern',
	async t => {
		t.timeout(10000);
		const result = await searchFilesTool.handler({
			pattern: '**/*.nonexistentextension',
			maxResults: 10,
		});

		t.regex(result, /No files found/);
	},
);

// ============================================================================
// Tests for search_files Tool Configuration
// ============================================================================

test('search_files tool has correct name', t => {
	t.is(searchFilesTool.name, 'search_files');
});

test('search_files tool does not require confirmation', t => {
	t.false(searchFilesTool.requiresConfirmation);
});

test('search_files tool has handler function', t => {
	t.is(typeof searchFilesTool.handler, 'function');
});

test('search_files tool has formatter function', t => {
	t.is(typeof searchFilesTool.formatter, 'function');
});
