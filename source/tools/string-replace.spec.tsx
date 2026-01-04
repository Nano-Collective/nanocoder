import test from 'ava';
import type {RenderOptions} from 'ink-testing-library';
import {render} from 'ink-testing-library';
import {writeFile, readFile, unlink, mkdir} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {rm} from 'node:fs/promises';

import {stringReplaceTool} from './string-replace';
import {getColors} from '@/config/index';
import {getCachedFileContent} from '@/utils/file-cache';

interface MockFileCache {
	set(file: string, content: {content: string; lines: string[]; mtime: number}): void;
}

// Mock file cache for testing
const mockCache: Map<string, {content: string; lines: string[]; mtime: number}> = new Map();

let testDir: string;
let originalCwd: string;

test.before(async () => {
	// Create a test directory
	testDir = resolve(tmpdir(), `nanocoder-string-replace-test-${Date.now()}`);
	await mkdir(testDir, {recursive: true});
	originalCwd = process.cwd();
	process.chdir(testDir);
});

test.after.always(async () => {
	// Restore original working directory
	process.chdir(originalCwd);
	// Clean up test directory
	try {
		await rm(testDir, {recursive: true, force: true});
	} catch {}
});

// Helper to create a test file
async function createTestFile(content: string): Promise<string> {
	const fileName = `test-${Date.now()}-${Math.random().toString(36).substring(7)}.txt`;
	const tempPath = join(testDir, fileName);
	await writeFile(tempPath, content, 'utf-8');

	// Update file cache
	const lines = content.split('\n');
	mockCache.set(tempPath, {content, lines, mtime: Date.now()});

	// Return relative path from test directory
	return fileName;
}

// Helper to clean up test file
async function cleanupTestFile(path: string): Promise<void> {
	try {
		const fullPath = join(testDir, path);
		await unlink(fullPath);
		mockCache.delete(fullPath);
	} catch {
		// Try cleaning up by absolute path too
		try {
			await unlink(path);
			mockCache.delete(path);
		} catch {}
	}
}

// Helper to get cached content for testing
async function getCachedContentForTesting(path: string): Promise<{content: string; lines: string[]; mtime: number}> {
	const fullPath = resolve(path);
	const cached = mockCache.get(fullPath);
	if (!cached) {
		const content = await readFile(fullPath, 'utf-8');
		const lines = content.split('\n');
		const data = {content, lines, mtime: Date.now()};
		mockCache.set(fullPath, data);
		return data;
	}
	return cached;
}

test('should replace exact string content in file', async t => {
	const content = 'line 1\nline 2\nline 3\nline 4';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: 'line 2',
			new_str: 'replaced line',
		};

		const result = await stringReplaceTool.tool.execute(args);
		t.true(result.includes('Successfully replaced'));

		const newContent = await readFile(testPath, 'utf-8');
		t.is(newContent, 'line 1\nreplaced line\nline 3\nline 4');
	} finally {
		await cleanupTestFile(testPath);
	}
});

test('should replace multi-line content', async t => {
	const content = 'line 1\nline 2\nline 3\nline 4\nline 5';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: 'line 2\nline 3',
			new_str: 'merged line',
		};

		const result = await stringReplaceTool.tool.execute(args);
		t.true(result.includes('Successfully replaced'));

		const newContent = await readFile(testPath, 'utf-8');
		t.is(newContent, 'line 1\nmerged line\nline 4\nline 5');
	} finally {
		await cleanupTestFile(testPath);
	}
});

test('should throw error when old_str is empty', async t => {
	const content = 'line 1\nline 2';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: '',
			new_str: 'something',
		};

		await t.throwsAsync(
			async () => stringReplaceTool.tool.execute(args),
			{message: /old_str cannot be empty/},
		);
	} finally {
		await cleanupTestFile(testPath);
	}
});

test('should throw error when content not found', async t => {
	const content = 'line 1\nline 2';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: 'nonexistent line',
			new_str: 'replacement',
		};

		await t.throwsAsync(
			async () => stringReplaceTool.tool.execute(args),
			{message: /Content not found/},
		);
	} finally {
		await cleanupTestFile(testPath);
	}
});

test('should throw error when multiple matches found', async t => {
	const content = 'line 1\nline 2\nline 2\nline 3';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: 'line 2',
			new_str: 'replacement',
		};

		await t.throwsAsync(
			async () => stringReplaceTool.tool.execute(args),
			{message: /Found 2 matches/},
		);
	} finally {
		await cleanupTestFile(testPath);
	}
});

test('should delete content when new_str is empty', async t => {
	const content = 'line 1\nline 2\nline 3';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: 'line 2\n',
			new_str: '',
		};

		const result = await stringReplaceTool.tool.execute(args);
		t.true(result.includes('Successfully replaced'));

		const newContent = await readFile(testPath, 'utf-8');
		t.is(newContent, 'line 1\nline 3');
	} finally {
		await cleanupTestFile(testPath);
	}
});

test('should handle unicode content', async t => {
	const content = 'Hello 世界\nПривет мир\nBonjour monde';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: 'Привет мир',
			new_str: 'Привет Россия',
		};

		const result = await stringReplaceTool.tool.execute(args);
		t.true(result.includes('Successfully replaced'));

		const newContent = await readFile(testPath, 'utf-8');
		t.is(newContent, 'Hello 世界\nПривет Россия\nBonjour monde');
	} finally {
		await cleanupTestFile(testPath);
	}
});

test('should validate file path', async t => {
	const args = {
		path: '../../../etc/passwd', // Path traversal attempt
		old_str: 'something',
		new_str: 'replacement',
	};

	const result = await stringReplaceTool.validator!(args);
	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('Invalid file path'));
	}
});

test('should validate file exists', async t => {
	const args = {
		path: 'nonexistent-file.txt',
		old_str: 'something',
		new_str: 'replacement',
	};

	const result = await stringReplaceTool.validator!(args);
	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('does not exist'));
	}
});

test('should validate old_str is not empty', async t => {
	const content = 'line 1\nline 2';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: '',
			new_str: 'replacement',
		};

		const result = await stringReplaceTool.validator!(args);
		t.false(result.valid);
		if (!result.valid) {
			t.true(result.error.includes('cannot be empty'));
		}
	} finally {
		await cleanupTestFile(testPath);
	}
});

test('should validate content is unique in file', async t => {
	const content = 'line 1\nline 2\nline 2\nline 3';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: 'line 2',
			new_str: 'replacement',
		};

		const result = await stringReplaceTool.validator!(args);
		t.false(result.valid);
		if (!result.valid) {
			t.true(result.error.includes('matches'));
		}
	} finally {
		await cleanupTestFile(testPath);
	}
});

test('should pass validation for valid unique content', async t => {
	const content = 'line 1\nline 2\nline 3';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: 'line 2',
			new_str: 'replacement',
		};

		const result = await stringReplaceTool.validator!(args);
		t.true(result.valid);
	} finally {
		await cleanupTestFile(testPath);
	}
});

test('should generate valid preview with DiffDisplay', async t => {
	const content = 'function test() {\n  const x = 1;\n  return x;\n}';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: '  const x = 1;',
			new_str: '  const x = 2;',
		};

		const preview = await stringReplaceTool.formatter!(args);
		t.truthy(preview);
	} finally {
		await cleanupTestFile(testPath);
	}
});

test('should handle special characters in content', async t => {
	const content = 'line with "quotes"\nline with \'apostrophes\'\nline with $variables';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: 'line with "quotes"',
			new_str: 'line without quotes',
		};

		const result = await stringReplaceTool.tool.execute(args);
		t.true(result.includes('Successfully replaced'));

		const newContent = await readFile(testPath, 'utf-8');
		t.is(newContent, 'line without quotes\nline with \'apostrophes\'\nline with $variables');
	} finally {
		await cleanupTestFile(testPath);
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

test('should preserve file encoding', async t => {
	const content = 'const π = 3.14159;\nconst ∑ = 0;';
	const testPath = await createTestFile(content);

	try {
		const args = {
			path: testPath,
			old_str: 'const π = 3.14159;',
			new_str: 'const pi = 3.14159;',
		};

		await stringReplaceTool.tool.execute(args);

		const newContent = await readFile(testPath, 'utf-8');
		t.is(newContent, 'const pi = 3.14159;\nconst ∑ = 0;');
	} finally {
		await cleanupTestFile(testPath);
	}
});
