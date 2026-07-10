import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {EMPTY_CONTENT_MARKER} from '../constants';
import {ThemeContext} from '../hooks/useTheme';
import {readFileTool} from './read-file';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\nread-file.spec.tsx – ${React.version}`);

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
// Tests for ReadFileFormatter Component Rendering
// ============================================================================

test('ReadFileFormatter renders with path', async t => {
	const testDir = join(process.cwd(), 'test-fmt');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'test.ts'), 'const x = 1;');

		const formatter = readFileTool.formatter;
		if (!formatter) {
			t.fail('Formatter is not defined');
			return;
		}

		const element = await formatter(
			{path: join(testDir, 'test.ts')},
			'const x = 1;',
		);
		const {lastFrame} = render(
			<TestThemeProvider>{element}</TestThemeProvider>,
		);

		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, /read_file/);
		// The path might be truncated or split across lines depending on terminal width
		t.regex(output!, /test\.ts|tes[\s\S]*?t\.ts|test/);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test('ReadFileFormatter shows metadata only indicator', async t => {
	const testDir = join(process.cwd(), 'test-read-metadata-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		const content = 'line\n'.repeat(400); // Over 300 lines
		writeFileSync(join(testDir, 'large.ts'), content);

		const formatter = readFileTool.formatter;
		if (!formatter) {
			t.fail('Formatter is not defined');
			return;
		}

		const element = await formatter(
			{path: join(testDir, 'large.ts')},
			'File: large.ts\nType: TypeScript\nTotal lines: 400',
		);
		const {lastFrame} = render(
			<TestThemeProvider>{element}</TestThemeProvider>,
		);

		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, /metadata\s+only/);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test('ReadFileFormatter handles error results gracefully', async t => {
	const formatter = readFileTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = await formatter(
		{path: 'nonexistent.ts'},
		'Error: File not found',
	);
	const {lastFrame} = render(element);

	const output = lastFrame();
	t.is(output, '');
});

test('ReadFileFormatter displays line range for partial reads', async t => {
	const testDir = join(process.cwd(), 'test-read-range-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(
			join(testDir, 'test.ts'),
			'line1\nline2\nline3\nline4\nline5',
		);

		const formatter = readFileTool.formatter;
		if (!formatter) {
			t.fail('Formatter is not defined');
			return;
		}

		const element = await formatter(
			{path: join(testDir, 'test.ts'), start_line: 2, end_line: 4},
			'line2\nline3\nline4',
		);
		const {lastFrame} = render(
			<TestThemeProvider>{element}</TestThemeProvider>,
		);

		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, /Lines:/);
		t.regex(output!, /2 - 4/);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

// ============================================================================
// Tests for read_file Handler - Progressive Disclosure
// ============================================================================

test.serial(
	'read_file returns content directly for small files (<300 lines)',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-read-small-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			const content = 'line\n'.repeat(100);
			writeFileSync(join(testDir, 'small.ts'), content);

			const result = await readFileTool.tool.execute!(
				{
					path: join(testDir, 'small.ts'),
				},
				{toolCallId: 'test', messages: []},
			);

			// Should return content without line numbers, not metadata
			t.true(result.includes('line'));
			t.false(result.includes('File:'));
			// Should NOT have line number prefixes
			t.false(/^\s*1:/.test(result));
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'read_file returns metadata for files >300 lines without ranges',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-read-metadata-only-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			const content = 'line\n'.repeat(400);
			writeFileSync(join(testDir, 'large.ts'), content);

			const result = await readFileTool.tool.execute!(
				{
					path: join(testDir, 'large.ts'),
				},
				{toolCallId: 'test', messages: []},
			);

			// Should return metadata, not content
			t.regex(result, /File:/);
			t.regex(result, /Type: TypeScript/);
			t.regex(result, /Total lines: \d+/); // Don't check exact number
			t.regex(result, /Estimated tokens:/);
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'read_file returns content for files >300 lines with ranges',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-read-large-range-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			const content = 'line\n'.repeat(400);
			writeFileSync(join(testDir, 'large.ts'), content);

			const result = await readFileTool.tool.execute!(
				{
					path: join(testDir, 'large.ts'),
					start_line: 1,
					end_line: 50,
				},
				{toolCallId: 'test', messages: []},
			);

			// Should return content without line numbers
			t.true(result.includes('line'));
			t.false(result.includes('File:'));
			// Should NOT have line number prefixes
			t.false(/^\s*1:/.test(result));
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'read_file provides progressive read suggestions for medium files',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-read-medium-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			const content = 'line\n'.repeat(350);
			writeFileSync(join(testDir, 'medium.ts'), content);

			const result = await readFileTool.tool.execute!(
				{
					path: join(testDir, 'medium.ts'),
				},
				{toolCallId: 'test', messages: []},
			);

			// Should suggest progressive reading
			t.regex(result, /Medium file/);
			t.regex(result, /start_line: 1, end_line: 250/);
			t.regex(result, /start_line: 251/);
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial('read_file provides chunk suggestions for large files', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-chunks-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		const content = 'line\n'.repeat(1000);
		writeFileSync(join(testDir, 'large.ts'), content);

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'large.ts'),
			},
			{toolCallId: 'test', messages: []},
		);

		// Should suggest chunked reading
		t.regex(result, /Large file/);
		t.regex(result, /Targeted read/);
		t.regex(result, /Progressive read/);
		t.regex(result, /Example chunks/);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

// ============================================================================
// Tests for read_file Handler - Line Range Reading
// ============================================================================

test.serial('read_file reads specific line range', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-range-specific-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(
			join(testDir, 'test.ts'),
			'line1\nline2\nline3\nline4\nline5',
		);

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'test.ts'),
				start_line: 2,
				end_line: 4,
			},
			{toolCallId: 'test', messages: []},
		);

		// Should only contain lines 2-4 without line number prefixes
		t.true(result.includes('line2'));
		t.true(result.includes('line3'));
		t.true(result.includes('line4'));
		t.false(result.includes('line1'));
		t.false(result.includes('line5'));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file handles start_line only', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-start-only-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(
			join(testDir, 'test.ts'),
			'line1\nline2\nline3\nline4\nline5',
		);

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'test.ts'),
				start_line: 3,
			},
			{toolCallId: 'test', messages: []},
		);

		// Should read from line 3 to end without line number prefixes
		t.false(result.includes('line1'));
		t.false(result.includes('line2'));
		t.true(result.includes('line3'));
		t.true(result.includes('line5'));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file handles end_line only', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-end-only-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(
			join(testDir, 'test.ts'),
			'line1\nline2\nline3\nline4\nline5',
		);

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'test.ts'),
				end_line: 3,
			},
			{toolCallId: 'test', messages: []},
		);

		// Should read from start to line 3 without line number prefixes
		t.true(result.includes('line1'));
		t.true(result.includes('line3'));
		t.false(result.includes('line4'));
		t.false(result.includes('line5'));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file clamps line ranges to file bounds', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-clamp-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'test.ts'), 'line1\nline2\nline3');

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'test.ts'),
				start_line: 0, // Should clamp to 1
				end_line: 100, // Should clamp to 3
			},
			{toolCallId: 'test', messages: []},
		);

		// Should read entire file without line number prefixes
		t.true(result.includes('line1'));
		t.true(result.includes('line3'));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

// ============================================================================
// Tests for read_file Handler - File Type Detection
// ============================================================================

test.serial('read_file detects common file types', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-types-temp');

	try {
		mkdirSync(testDir, {recursive: true});

		const files = {
			'file.ts': 'TypeScript',
			'file.tsx': 'TypeScript React',
			'file.js': 'JavaScript',
			'file.py': 'Python',
			'file.go': 'Go',
			'file.md': 'Markdown',
			'file.json': 'JSON',
		};

		for (const [filename, expectedType] of Object.entries(files)) {
			const content = 'line\n'.repeat(400);
			writeFileSync(join(testDir, filename), content);

			const result = await readFileTool.tool.execute!(
				{
					path: join(testDir, filename),
				},
				{toolCallId: 'test', messages: []},
			);

			t.regex(
				result,
				new RegExp(`Type: ${expectedType}`),
				`Should detect ${expectedType}`,
			);
		}
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

// ============================================================================
// Tests for read_file Validator
// ============================================================================

test.serial('read_file validator rejects nonexistent files', async t => {
	t.timeout(10000);

	const result = await readFileTool.validator!({
		path: '/nonexistent/file.ts',
	});

	t.false(result.valid);
	if (!result.valid) {
		// Path validation rejects absolute paths first
		t.regex(result.error, /Invalid file path/);
	}
});

test.serial('read_file validator accepts valid files', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-validate-temp');
	const originalCwd = process.cwd();

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'test.ts'), 'content');
		process.chdir(testDir);

		const result = await readFileTool.validator!({
			path: 'test.ts',
		});

		t.true(result.valid);
	} finally {
		process.chdir(originalCwd);
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file validator rejects start_line < 1', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-validate-start-temp');
	const originalCwd = process.cwd();

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'test.ts'), 'content');
		process.chdir(testDir);

		const result = await readFileTool.validator!({
			path: 'test.ts',
			start_line: 0,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /start_line must be >= 1/);
		}
	} finally {
		process.chdir(originalCwd);
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file validator rejects end_line < start_line', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-validate-range-temp');
	const originalCwd = process.cwd();

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'test.ts'), 'line1\nline2\nline3');
		process.chdir(testDir);

		const result = await readFileTool.validator!({
			path: 'test.ts',
			start_line: 3,
			end_line: 1,
		});

		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /end_line must be >= start_line/);
		}
	} finally {
		process.chdir(originalCwd);
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file validator clamps end_line to file length', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-validate-length-temp');
	const originalCwd = process.cwd();

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'test.ts'), 'line1\nline2\nline3');
		process.chdir(testDir);

		const args = {path: 'test.ts', end_line: 100};
		const result = await readFileTool.validator!(args);

		// Validator should accept and clamp end_line instead of rejecting
		t.true(result.valid);
		t.is(args.end_line, 3);
	} finally {
		process.chdir(originalCwd);
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'read_file validator rejects files with minified/binary content',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-read-validate-minified-temp');
		const originalCwd = process.cwd();

		try {
			mkdirSync(testDir, {recursive: true});
			// Create a file with a very long line (>10,000 chars)
			const longLine = 'x'.repeat(15000);
			writeFileSync(join(testDir, 'minified.js'), longLine);
			process.chdir(testDir);

			const result = await readFileTool.validator!({
				path: 'minified.js',
			});

			t.false(result.valid);
			if (!result.valid) {
				t.regex(result.error, /minified or binary content/);
				t.regex(result.error, /15,000 characters/);
			}
		} finally {
			process.chdir(originalCwd);
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'read_file validator allows metadata_only for minified files',
	async t => {
		t.timeout(10000);
		const testDir = join(
			process.cwd(),
			'test-read-validate-minified-metadata-temp',
		);
		const originalCwd = process.cwd();

		try {
			mkdirSync(testDir, {recursive: true});
			// Create a file with a very long line (>10,000 chars)
			const longLine = 'x'.repeat(15000);
			writeFileSync(join(testDir, 'minified.js'), longLine);
			process.chdir(testDir);

			const result = await readFileTool.validator!({
				path: 'minified.js',
				metadata_only: true,
			});

			t.true(result.valid);
		} finally {
			process.chdir(originalCwd);
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

// ============================================================================
// Tests for read_file Handler - Error Handling
// ============================================================================

test.serial('read_file throws error for nonexistent file', async t => {
	t.timeout(10000);

	await t.throwsAsync(
		async () => {
			await readFileTool.tool.execute!(
				{
					path: '/nonexistent/file.ts',
				},
				{toolCallId: 'test', messages: []},
			);
		},
		{message: /does not exist/},
	);
});

test.serial('read_file returns empty marker for empty files', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-empty-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'empty.ts'), '');

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'empty.ts'),
			},
			{toolCallId: 'test', messages: []},
		);

		t.is(result, EMPTY_CONTENT_MARKER);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'read_file returns empty marker for empty files with line ranges',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-read-empty-ranges-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(join(testDir, 'empty.ts'), '');

			const result = await readFileTool.tool.execute!(
				{
					path: join(testDir, 'empty.ts'),
					start_line: 1,
					end_line: 10,
				},
				{toolCallId: 'test', messages: []},
			);

			t.is(result, EMPTY_CONTENT_MARKER);
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'read_file metadata_only returns file info for empty files without short-circuiting',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-read-empty-metadata-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(join(testDir, 'empty.ts'), '');

			const result = (await readFileTool.tool.execute!(
				{
					path: join(testDir, 'empty.ts'),
					metadata_only: true,
				},
				{toolCallId: 'test', messages: []},
			)) as string;

			t.true(result.includes('File Information for'));
			t.true(result.includes('Size: 0 bytes'));
			t.false(result.includes(EMPTY_CONTENT_MARKER));
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'read_file handles file containing only newline (non-empty)',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-read-newline-only-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			// File with single newline character - has content (length === 1)
			writeFileSync(join(testDir, 'newline.ts'), '\n');

			const result = await readFileTool.tool.execute!(
				{
					path: join(testDir, 'newline.ts'),
				},
				{toolCallId: 'test', messages: []},
			);

			// Should NOT return empty marker (content.length === 1, not 0)
			// File splits into 2 lines ['', ''] and joining returns '\n'
			t.not(result, EMPTY_CONTENT_MARKER);
			t.is(result, '\n');
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

// ============================================================================
// Edge Cases and Stress Tests
// ============================================================================

test.serial('read_file handles files with unicode characters', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-unicode-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(
			join(testDir, 'unicode.ts'),
			'const greeting = "Hello 世界 🌍";\nconst emoji = "🚀";',
			'utf-8',
		);

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'unicode.ts'),
			},
			{toolCallId: 'test', messages: []},
		);

		t.true(result.includes('世界'));
		t.true(result.includes('🌍'));
		t.true(result.includes('🚀'));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file handles files with very long lines', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-long-lines-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		const longLine = 'a'.repeat(10000);
		writeFileSync(join(testDir, 'long.ts'), `${longLine}\nshort line`);

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'long.ts'),
			},
			{toolCallId: 'test', messages: []},
		);

		t.true(result.includes('a'.repeat(100))); // Should include long content
		t.true(result.includes('short line'));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file handles files with Windows line endings', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-crlf-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'windows.ts'), 'line1\r\nline2\r\nline3');

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'windows.ts'),
			},
			{toolCallId: 'test', messages: []},
		);

		// Should handle CRLF properly - content returned without line numbers
		t.true(result.includes('line1'));
		t.true(result.includes('line2'));
		t.true(result.includes('line3'));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file handles files with mixed line endings', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-mixed-endings-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'mixed.ts'), 'line1\nline2\r\nline3\n');

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'mixed.ts'),
			},
			{toolCallId: 'test', messages: []},
		);

		// Should handle mixed line endings
		t.truthy(result);
		t.false(result.includes('Error'));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'read_file handles files with special characters in path',
	async t => {
		t.timeout(10000);
		const testDir = join(process.cwd(), 'test-read-special-path-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			mkdirSync(join(testDir, 'dir-with-dash'), {recursive: true});
			writeFileSync(
				join(testDir, 'dir-with-dash', 'file_with_underscore.ts'),
				'content',
			);

			const result = await readFileTool.tool.execute!(
				{
					path: join(testDir, 'dir-with-dash', 'file_with_underscore.ts'),
				},
				{toolCallId: 'test', messages: []},
			);

			t.truthy(result);
			t.true(result.includes('content'));
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial('read_file handles files without extension', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-no-ext-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		const content = 'line\n'.repeat(400);
		writeFileSync(join(testDir, 'Makefile'), content);

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'Makefile'),
			},
			{toolCallId: 'test', messages: []},
		);

		// Should still provide metadata
		t.regex(result, /File: .*Makefile/);
		t.regex(result, /Total lines: \d+/); // Don't check exact number
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file returns content without line numbers', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-read-no-linenums-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'test.ts'), 'line1\nline2\nline3');

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'test.ts'),
			},
			{toolCallId: 'test', messages: []},
		);

		// Content should be returned without line number prefixes
		t.true(result.includes('line1'));
		t.true(result.includes('line2'));
		t.true(result.includes('line3'));
		// Should NOT have line number prefixes like "   1: "
		t.false(/^\s*\d+:/.test(result));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

// ============================================================================
// Tests for read_file Tool Configuration
// ============================================================================

test('read_file tool has correct name', t => {
	t.is(readFileTool.name, 'read_file');
});

test('read_file tool does not require confirmation', t => {
	// Read-only tools default to no approval (see resolveToolApproval).
	t.true(readFileTool.readOnly);
	t.is(readFileTool.approval, undefined);
});

test('read_file tool has handler function', t => {
	t.is(typeof readFileTool.tool.execute, 'function');
});

test('read_file tool has formatter function', t => {
	t.is(typeof readFileTool.formatter, 'function');
});

test('read_file tool has validator function', t => {
	t.is(typeof readFileTool.validator, 'function');
});

// ============================================================================
// Tests for read_file Handler - metadata_only Feature
// ============================================================================

test.serial('read_file metadata_only returns file info without content', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-meta');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'test.ts'), 'const x = 1;\nconst y = 2;');

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'test.ts'),
				metadata_only: true,
			},
			{toolCallId: 'test', messages: []},
		);

		t.regex(result, /File Information for/);
		t.regex(result, /Type: file/);
		t.regex(result, /Size:/);
		t.regex(result, /Lines:/);
		t.regex(result, /File Type: TypeScript/);
		t.regex(result, /Encoding:/);
		// Should NOT include actual file content
		t.false(result.includes('const x = 1'));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file metadata_only handles directories', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-meta-dir');

	try {
		mkdirSync(testDir, {recursive: true});
		mkdirSync(join(testDir, 'subdir'), {recursive: true});

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'subdir'),
				metadata_only: true,
			},
			{toolCallId: 'test', messages: []},
		);

		t.regex(result, /Type: directory/);
		t.regex(result, /list_directory/);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file metadata_only shows last modified time', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-meta-time');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'test.ts'), 'content');

		const result = await readFileTool.tool.execute!(
			{
				path: join(testDir, 'test.ts'),
				metadata_only: true,
			},
			{toolCallId: 'test', messages: []},
		);

		t.regex(result, /Last Modified:/);
		// ISO format: YYYY-MM-DDTHH:MM:SS
		t.regex(result, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file metadata_only shows converted binary encoding for PDF', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-meta-pdf');

	try {
		mkdirSync(testDir, {recursive: true});
		const pdfContent = `%PDF-1.1
%\xA5\xB1\xEB
1 0 obj
  << /Type /Catalog
     /Pages 2 0 R
  >>
endobj
2 0 obj
  << /Type /Pages
     /Kids [3 0 R]
     /Count 1
     /MediaBox [0 0 300 144]
  >>
endobj
3 0 obj
  <<  /Type /Page
      /Parent 2 0 R
      /Resources
       << /Font
           << /F1
               << /Type /Font
                  /Subtype /Type1
                  /BaseFont /Times-Roman
               >>
           >>
       >>
      /Contents 4 0 R
  >>
endobj
4 0 obj
  << /Length 55 >>
stream
  BT
    /F1 18 Tf
    0 0 Td
    (Hello World) Tj
  ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000018 00000 n 
0000000077 00000 n 
0000000178 00000 n 
0000000457 00000 n 
trailer
  <<  /Root 1 0 R
      /Size 5
  >>
startxref
565
%%EOF`;
		writeFileSync(join(testDir, 'test.pdf'), pdfContent);

		const result = (await readFileTool.tool.execute!(
			{
				path: join(testDir, 'test.pdf'),
				metadata_only: true,
			},
			{toolCallId: 'test', messages: []},
		)) as string;

		t.regex(result, /Encoding: Binary \(Converted to Markdown\)/);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('read_file metadata_only shows converted binary encoding for DOCX', async t => {
	t.timeout(10000);
	const testDir = join(process.cwd(), 'test-meta-docx');

	try {
		mkdirSync(testDir, {recursive: true});
		const docxBase64 = 'UEsDBBQAAAAAAOtT6lzMVIwQnAEAAJwBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04Ij8+PFR5cGVzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L2NvbnRlbnQtdHlwZXMiPjxEZWZhdWx0IEV4dGVuc2lvbj0icmVscyIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1wYWNrYWdlLnJlbGF0aW9uc2hpcHMreG1sIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJ4bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi94bWwiLz48T3ZlcnJpZGUgUGFydE5hbWU9Ii93b3JkL2RvY3VtZW50LnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC53b3JkcHJvY2Vzc2luZ21sLmRvY3VtZW50Lm1haW4reG1sIi8+PC9UeXBlcz5QSwMEFAAAAAAA61PqXDZX3twYAQAAGAEAAAsAAABfcmVscy8ucmVsczw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04Ij8+PFJlbGF0aW9uc2hpcHMgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9wYWNrYWdlLzIwMDYvcmVsYXRpb25zaGlwcyI+PFJlbGF0aW9uc2hpcCBJZD0icklkMSIgVHlwZT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcy9vZmZpY2VEb2N1bWVudCIgVGFyZ2V0PSJ3b3JkL2RvY3VtZW50LnhtbCIvPjwvUmVsYXRpb25zaGlwcz5QSwMEFAAAAAAA61PqXKOp4qS9AAAAvQAAABEAAAB3b3JkL2RvY3VtZW50LnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04Ij8+PHc6ZG9jdW1lbnQgeG1sbnM6dz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3dvcmRwcm9jZXNzaW5nbWwvMjAwNi9tYWluIj48dzpib2R5Pjx3OnA+PHc6cj48dzp0PkhlbGxvPC93OnQ+PC93OnI+PC93OnA+PC93OmJvZHk+PC93OmRvY3VtZW50PlBLAQIUAxQAAAAAAOtT6lzMVIwQnAEAAJwBAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAAA61PqXDZX3twYAQAAGAEAAAsAAAAAAAAAAAAAAIABzQEAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAAA61PqXKOp4qS9AAAAvQAAABEAAAAAAAAAAAAAAIABDgMAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAAPoDAAAAAA==';
		writeFileSync(join(testDir, 'test.docx'), Buffer.from(docxBase64, 'base64'));

		const result = (await readFileTool.tool.execute!(
			{
				path: join(testDir, 'test.docx'),
				metadata_only: true,
			},
			{toolCallId: 'test', messages: []},
		)) as string;

		t.regex(result, /Encoding: Binary \(Converted to Markdown\)/);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});
