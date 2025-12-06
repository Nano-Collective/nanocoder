import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {searchFileContentsTool} from './search-file-contents';
import {ThemeContext} from '../hooks/useTheme';
import {themes} from '../config/themes';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\nsearch-file-contents.spec.tsx – ${React.version}`);

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
// Tests for SearchFileContentsFormatter Component Rendering
// ============================================================================

test('SearchFileContentsFormatter renders with query', t => {
	const formatter = searchFileContentsTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{query: 'handleSubmit', maxResults: 30},
		'Found 12 matches',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /search_file_contents/);
	t.regex(output!, /handleSubmit/);
	t.regex(output!, /12/);
});

test('SearchFileContentsFormatter shows case sensitive indicator', t => {
	const formatter = searchFileContentsTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{query: 'TestClass', caseSensitive: true},
		'Found 5 matches',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Case sensitive:/);
	t.regex(output!, /yes/);
});

test('SearchFileContentsFormatter shows 0 results when no matches', t => {
	const formatter = searchFileContentsTool.formatter;
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

test('SearchFileContentsFormatter handles error results gracefully', t => {
	const formatter = searchFileContentsTool.formatter;
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

test('SearchFileContentsFormatter displays query parameter', t => {
	const formatter = searchFileContentsTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{query: 'importantFunction', maxResults: 30},
		'Found 8 matches',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.regex(output!, /Query:/);
	t.regex(output!, /importantFunction/);
});

test('SearchFileContentsFormatter displays match count', t => {
	const formatter = searchFileContentsTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({query: 'const'}, 'Found 42 matches');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.regex(output!, /Matches:/);
	t.regex(output!, /42/);
});

test('SearchFileContentsFormatter renders without crashing', t => {
	const formatter = searchFileContentsTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({query: 'test'}, 'Found 3 matches');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	// Should render without errors
	t.truthy(lastFrame());
});

// ============================================================================
// Tests for search_file_contents Tool Handler - Gitignore Integration
// ============================================================================

test.serial('search_file_contents respects .gitignore patterns', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-search-contents-gitignore-temp');

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
			'const testValue = "world";',
		);
		writeFileSync(join(testDir, 'file.ignore.txt'), 'const testValue = true;');
		writeFileSync(join(testDir, 'normal.txt'), 'const testValue = true;');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await searchFileContentsTool.tool.execute!(
				{
					query: 'testValue',
					maxResults: 30,
				},
				{toolCallId: 'test', messages: []},
			);

			t.false(
				result.includes('ignored-dir'),
				'Should not include ignored directory',
			);
			t.false(
				result.includes('file.ignore.txt'),
				'Should not include ignored pattern',
			);
			t.true(
				result.includes('src/test.ts') || result.includes('normal.txt'),
				'Should include non-ignored files',
			);
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'search_file_contents uses hardcoded ignores when no .gitignore exists',
	async t => {
		t.timeout(10000);
		const testDir = join(
			process.cwd(),
			'test-search-contents-no-gitignore-temp',
		);

		try {
			// Create test directory without .gitignore
			mkdirSync(testDir, {recursive: true});
			mkdirSync(join(testDir, 'node_modules'), {recursive: true});
			mkdirSync(join(testDir, 'src'), {recursive: true});

			// Create test files
			writeFileSync(
				join(testDir, 'node_modules', 'package.js'),
				'const searchTerm = true;',
			);
			writeFileSync(
				join(testDir, 'src', 'index.js'),
				'const searchTerm = true;',
			);

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				const result = await searchFileContentsTool.tool.execute!(
					{
						query: 'searchTerm',
						maxResults: 30,
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
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'search_file_contents handles multiple .gitignore patterns',
	async t => {
		t.timeout(10000);
		const testDir = join(
			process.cwd(),
			'test-search-contents-multi-ignore-temp',
		);

		try {
			// Create test directory structure
			mkdirSync(testDir, {recursive: true});
			mkdirSync(join(testDir, 'src'), {recursive: true});
			mkdirSync(join(testDir, 'temp'), {recursive: true});
			mkdirSync(join(testDir, 'cache'), {recursive: true});

			// Create .gitignore with multiple patterns
			writeFileSync(
				join(testDir, '.gitignore'),
				'temp/\ncache/\n*.tmp\n*.log\n',
			);

			// Create test files
			writeFileSync(
				join(testDir, 'src', 'app.ts'),
				'const searchQuery = "test";',
			);
			writeFileSync(
				join(testDir, 'temp', 'file.ts'),
				'const searchQuery = "temp";',
			);
			writeFileSync(
				join(testDir, 'cache', 'data.ts'),
				'const searchQuery = "cache";',
			);
			writeFileSync(join(testDir, 'debug.log'), 'searchQuery found');
			writeFileSync(join(testDir, 'temp.tmp'), 'searchQuery here');

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				const result = await searchFileContentsTool.tool.execute!(
					{
						query: 'searchQuery',
						maxResults: 30,
					},
					{toolCallId: 'test', messages: []},
				);

				t.true(result.includes('src/app.ts'), 'Should include normal files');
				t.false(result.includes('temp/'), 'Should ignore temp directory');
				t.false(result.includes('cache/'), 'Should ignore cache directory');
				t.false(result.includes('debug.log'), 'Should ignore .log files');
				t.false(result.includes('temp.tmp'), 'Should ignore .tmp files');
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

// ============================================================================
// Tests for search_file_contents Tool Handler - Search Functionality
// ============================================================================

test.serial(
	'search_file_contents performs case-insensitive search by default',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-search-case-insensitive-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(
				join(testDir, 'test.ts'),
				'const MyVariable = "value";\nconst myvariable = "another";',
			);

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				const result = await searchFileContentsTool.tool.execute!(
					{
						query: 'myvariable',
						maxResults: 30,
					},
					{toolCallId: 'test', messages: []},
				);

				// Should find both MyVariable and myvariable
				t.true(result.includes('test.ts'), 'Should find matches');
				const matches = result
					.split('\n')
					.filter((line: string) => line.includes(':'));
				t.true(matches.length >= 2, 'Should find both case variations');
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'search_file_contents performs case-sensitive search when specified',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-search-case-sensitive-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(
				join(testDir, 'test.ts'),
				'const MyVariable = "value";\nconst myvariable = "another";',
			);

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				const result = await searchFileContentsTool.tool.execute!(
					{
						query: 'MyVariable',
						caseSensitive: true,
						maxResults: 30,
					},
					{toolCallId: 'test', messages: []},
				);

				// Should only find MyVariable, not myvariable
				t.true(result.includes('MyVariable'), 'Should find exact case match');
				const lines = result.split('\n');
				const matchLines = lines.filter((line: string) =>
					line.includes('MyVariable'),
				).length;
				t.is(matchLines, 1, 'Should find only one exact match');
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'search_file_contents returns file:line format with content',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-search-format-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(
				join(testDir, 'example.ts'),
				'line one\nconst target = "found";\nline three',
			);

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				const result = await searchFileContentsTool.tool.execute!(
					{
						query: 'target',
						maxResults: 30,
					},
					{toolCallId: 'test', messages: []},
				);

				// Should have file:line format
				t.regex(result, /example\.ts:\d+/, 'Should have file:line format');
				t.true(
					result.includes('const target = "found"'),
					'Should include matching line content',
				);
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'search_file_contents returns no matches message for nonexistent query',
	async t => {
		t.timeout(10000);
		// Use a unique string that won't appear in source files
		const uniqueQuery = `zzz${Date.now()}nonexistent${Math.random()}`;
		const result = await searchFileContentsTool.tool.execute!(
			{
				query: uniqueQuery,
				maxResults: 30,
			},
			{toolCallId: 'test', messages: []},
		);

		t.regex(result, /No matches found/);
	},
);

// ============================================================================
// Tests for search_file_contents Tool Configuration
// ============================================================================

test('search_file_contents tool has correct name', t => {
	t.is(searchFileContentsTool.name, 'search_file_contents');
});

test('search_file_contents tool does not require confirmation', t => {
	t.false(searchFileContentsTool.tool.needsApproval);
});

test('search_file_contents tool has handler function', t => {
	t.is(typeof searchFileContentsTool.tool.execute, 'function');
});

test('search_file_contents tool has formatter function', t => {
	t.is(typeof searchFileContentsTool.formatter, 'function');
});

// ============================================================================
// Tests for maxResults Cap
// ============================================================================

test.serial('search_file_contents enforces max cap of 100 results', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-search-max-cap-temp');

	try {
		// Create a test directory with many matching files
		mkdirSync(testDir, {recursive: true});

		// Create 150 files with the word "searchTarget" to test the cap
		for (let i = 0; i < 150; i++) {
			writeFileSync(
				join(testDir, `file${i}.ts`),
				`const searchTarget${i} = "value";`,
			);
		}

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			// Request more than 100 results but should be capped at 100
			const result = await searchFileContentsTool.tool.execute!(
				{
					query: 'searchTarget',
					maxResults: 500, // Request 500, but should cap at 100
				},
				{toolCallId: 'test', messages: []},
			);

			// Check that the result doesn't exceed 100 matches
			const firstLine = result.split('\n')[0];
			const matchCount = firstLine.match(/Found (\d+)/);

			t.truthy(matchCount, 'Should have match count in result');

			if (matchCount) {
				const count = parseInt(matchCount[1], 10);
				t.true(count <= 100, `Found ${count} matches, should be max 100`);
			}
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'search_file_contents respects maxResults when less than cap',
	async t => {
		t.timeout(10000);
		const result = await searchFileContentsTool.tool.execute!(
			{
				query: 'const',
				maxResults: 5, // Request only 5
			},
			{toolCallId: 'test', messages: []},
		);

		// Should respect the lower limit
		t.truthy(result);
		t.false(result.includes('Error'));
	},
);

// ============================================================================
// Edge Cases and Stress Tests
// ============================================================================

test.serial(
	'search_file_contents handles special regex characters in query',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-search-special-chars-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(
				join(testDir, 'test.ts'),
				'const value = (x) => x + 1;\nconst array = [1, 2, 3];',
			);

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				// Test parentheses
				const result1 = await searchFileContentsTool.tool.execute!(
					{
						query: '(x)',
						maxResults: 30,
					},
					{toolCallId: 'test', messages: []},
				);
				t.true(result1.includes('(x) =>'), 'Should handle parentheses');

				// Test brackets
				const result2 = await searchFileContentsTool.tool.execute!(
					{
						query: '[1, 2, 3]',
						maxResults: 30,
					},
					{toolCallId: 'test', messages: []},
				);
				t.true(result2.includes('[1, 2, 3]'), 'Should handle brackets');
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial('search_file_contents handles multi-line matches', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-search-multiline-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(
			join(testDir, 'test.ts'),
			'function example() {\n  const searchTerm = "value";\n  return searchTerm;\n}',
		);

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await searchFileContentsTool.tool.execute!(
				{
					query: 'searchTerm',
					maxResults: 30,
				},
				{toolCallId: 'test', messages: []},
			);

			// Should find both occurrences
			const lines = result
				.split('\n')
				.filter((line: string) => line.includes('searchTerm'));
			t.true(
				lines.length >= 2,
				'Should find multiple occurrences on different lines',
			);
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'search_file_contents handles files with unicode characters',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-search-unicode-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(
				join(testDir, 'test.ts'),
				'const greeting = "Hello 世界 🌍";\nconst emoji = "🚀";',
				'utf-8',
			);

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				const result = await searchFileContentsTool.tool.execute!(
					{
						query: '世界',
						maxResults: 30,
					},
					{toolCallId: 'test', messages: []},
				);

				t.true(result.includes('世界'), 'Should handle Chinese characters');
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial('search_file_contents handles very long lines', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-search-long-lines-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		const longLine = 'a'.repeat(5000) + 'searchTarget' + 'b'.repeat(5000);
		writeFileSync(join(testDir, 'test.ts'), longLine);

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await searchFileContentsTool.tool.execute!(
				{
					query: 'searchTarget',
					maxResults: 30,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(result.includes('test.ts'), 'Should handle very long lines');
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('search_file_contents handles empty files gracefully', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-search-empty-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'empty.ts'), '');
		writeFileSync(join(testDir, 'nonempty.ts'), 'const searchTerm = true;');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await searchFileContentsTool.tool.execute!(
				{
					query: 'searchTerm',
					maxResults: 30,
				},
				{toolCallId: 'test', messages: []},
			);

			// Empty files shouldn't crash the search
			t.truthy(result);
			t.false(result.includes('Error'));
			t.true(
				result.includes('nonempty.ts'),
				'Should include files with matches',
			);
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'search_file_contents handles files with only whitespace',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-search-whitespace-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(join(testDir, 'whitespace.ts'), '   \n\n   \n');
			writeFileSync(join(testDir, 'normal.ts'), 'const searchTerm = true;');

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				const result = await searchFileContentsTool.tool.execute!(
					{
						query: 'searchTerm',
						maxResults: 30,
					},
					{toolCallId: 'test', messages: []},
				);

				t.false(
					result.includes('whitespace.ts'),
					'Should not match whitespace-only files',
				);
				t.true(result.includes('normal.ts'), 'Should match normal files');
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial('search_file_contents handles deeply nested files', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-search-deep-temp');

	try {
		const deepPath = join(testDir, 'a', 'b', 'c', 'd', 'e', 'f', 'g');
		mkdirSync(deepPath, {recursive: true});
		writeFileSync(join(deepPath, 'deep.ts'), 'const deepSearch = true;');

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await searchFileContentsTool.tool.execute!(
				{
					query: 'deepSearch',
					maxResults: 30,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(
				result.includes('deep.ts'),
				'Should find matches in deeply nested files',
			);
			t.true(
				result.includes('deepSearch'),
				'Should include the matching content',
			);
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('search_file_contents handles queries with quotes', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-search-quotes-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(
			join(testDir, 'test.ts'),
			'const str = "hello";\nconst str2 = \'world\';',
		);

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			// Search for string with double quotes
			const result = await searchFileContentsTool.tool.execute!(
				{
					query: '"hello"',
					maxResults: 30,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(result.includes('hello'), 'Should handle queries with quotes');
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'search_file_contents handles binary-like files gracefully',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-search-binary-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			// Write some binary-ish content
			const buffer = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
			writeFileSync(join(testDir, 'binary.dat'), buffer);
			writeFileSync(join(testDir, 'text.ts'), 'const searchTerm = true;');

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				// Should not crash when encountering binary files
				const result = await searchFileContentsTool.tool.execute!(
					{
						query: 'searchTerm',
						maxResults: 30,
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
	},
);

test.serial(
	'search_file_contents correctly excludes all hardcoded ignore patterns',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-search-hardcoded-temp');

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
				writeFileSync(
					join(testDir, dir, 'file.ts'),
					'const searchTerm = true;',
				);
			}

			mkdirSync(join(testDir, 'src'), {recursive: true});
			writeFileSync(
				join(testDir, 'src', 'file.ts'),
				'const searchTerm = true;',
			);

			const originalCwd = process.cwd();

			try {
				process.chdir(testDir);

				const result = await searchFileContentsTool.tool.execute!(
					{
						query: 'searchTerm',
						maxResults: 30,
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

test.serial('search_file_contents handles whitespace in query', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-search-whitespace-query-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(
			join(testDir, 'test.ts'),
			'const value = "hello world";\nconst x =  "test   spaces";',
		);

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const result = await searchFileContentsTool.tool.execute!(
				{
					query: 'hello world',
					maxResults: 30,
				},
				{toolCallId: 'test', messages: []},
			);

			t.true(
				result.includes('hello world'),
				'Should handle queries with spaces',
			);
		} finally {
			process.chdir(originalCwd);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});
