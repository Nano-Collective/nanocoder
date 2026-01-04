import test from 'ava';
import React from 'react';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

// Import the write_file tool functions
import type {WriteFileArgs} from './write-file';
import {
	WriteFileFormatter,
	executeWriteFile,
	writeFileValidator,
} from './write-file';
import {renderWithTheme} from '../test-utils/render-with-theme';

// Helper to create a temporary test directory
const createTestDir = (testName: string): string => {
	const testDir = join(tmpdir(), `nanocoder-test-${Date.now()}-${testName}`);
	mkdirSync(testDir, {recursive: true});
	return testDir;
};

// Helper to clean up test directory
const cleanupTestDir = (testDir: string): void => {
	try {
		rmSync(testDir, {recursive: true, force: true});
	} catch {
		// Ignore cleanup errors
	}
};

test('executeWriteFile: creates a new file', async t => {
	const testDir = createTestDir('new-file');
	const filePath = join(testDir, 'test.txt');
	const content = 'Hello, World!';

	try {
		const result = await executeWriteFile({
			path: filePath,
			content,
		});

		t.true(result.includes('File: '));
		t.true(result.includes('Type: '));
		t.true(result.includes('Lines: 1'));
		t.true(result.includes('Action: New file created'));
		t.true(result.includes('File contents:'));
		t.true(result.includes('Hello, World!'));
	} finally {
		cleanupTestDir(testDir);
	}
});

test('executeWriteFile: overwrites an existing file', async t => {
	const testDir = createTestDir('overwrite-file');
	const filePath = join(testDir, 'test.txt');
	const originalContent = 'Original content';
	const newContent = 'New content';

	try {
		// Create original file
		writeFileSync(filePath, originalContent, 'utf-8');

		const result = await executeWriteFile({
			path: filePath,
			content: newContent,
		});

		t.true(result.includes('Action: File replaced'));
		t.true(result.includes(`-${originalContent.split('\n').length} lines`));
		t.true(result.includes(`+${newContent.split('\n').length} lines`));
		t.true(result.includes('File contents:'));
		t.true(result.includes('New content'));
	} finally {
		cleanupTestDir(testDir);
	}
});

test('executeWriteFile: displays file type for TypeScript files', async t => {
	const testDir = createTestDir('file-type');
	const filePath = join(testDir, 'test.ts');
	const content = 'const x = 1;';

	try {
		const result = await executeWriteFile({
			path: filePath,
			content,
		});

		t.true(result.includes('Type: TypeScript'));
	} finally {
		cleanupTestDir(testDir);
	}
});

test('executeWriteFile: displays file type for TypeScript React files', async t => {
	const testDir = createTestDir('file-type-react');
	const filePath = join(testDir, 'test.tsx');
	const content = 'const x = 1;';

	try {
		const result = await executeWriteFile({
			path: filePath,
			content,
		});

		t.true(result.includes('Type: TypeScript React'));
	} finally {
		cleanupTestDir(testDir);
	}
});

test('executeWriteFile: uses progressive disclosure for large files', async t => {
	const testDir = createTestDir('large-file');
	const filePath = join(testDir, 'test.txt');
	// Create 400 lines
	const largeContent = Array.from({length: 400}, (_, i) => `Line ${i + 1}`).join('\n');

	try {
		const result = await executeWriteFile({
			path: filePath,
			content: largeContent,
		});

		t.true(result.includes('Lines: 400'));
		t.true(result.includes('[Large file'));
		t.true(result.includes('Showing preview of first'));
	} finally {
		cleanupTestDir(testDir);
	}
});

test('executeWriteFile: shows full content for small files', async t => {
	const testDir = createTestDir('small-file');
	const filePath = join(testDir, 'test.txt');
	const smallContent = 'Line 1\nLine 2\nLine 3';

	try {
		const result = await executeWriteFile({
			path: filePath,
			content: smallContent,
		});

		t.true(result.includes('Lines: 3'));
		t.true(result.includes('File contents:'));
		t.true(result.includes('Line 1'));
		t.true(result.includes('Line 2'));
		t.true(result.includes('Line 3'));
	} finally {
		cleanupTestDir(testDir);
	}
});

test('writeFileValidator: accepts valid file path', async t => {
	const testDir = createTestDir('validator-valid');

	try {
		// Change to test directory so relative paths work
		const originalCwd = process.cwd();
		process.chdir(testDir);

		try {
			const result = await writeFileValidator({
				path: 'test.txt',
				content: 'test content',
			});

			t.true(result.valid as boolean);
		} finally {
			// Restore original CWD before cleanup
			process.chdir(originalCwd);
		}
	} finally {
		cleanupTestDir(testDir);
	}
});

test('WriteFileFormatter: renders file type in preview', t => {
	const lastFrame = renderWithTheme(
		<WriteFileFormatter
			args={{
				path: 'test.tsx',
				content: 'const x = 1;',
			}}
		/>,
	).lastFrame();

	t.true(lastFrame?.includes('Type: TypeScript React'));
});

test('WriteFileFormatter: shows preview for large files', t => {
	// Create content with 400 lines
	const largeContent = Array.from({length: 400}, (_, i) => `Line ${i + 1}`).join('\n');

	const lastFrame = renderWithTheme(
		<WriteFileFormatter
			args={{
				path: 'large.txt',
				content: largeContent,
			}}
		/>,
	).lastFrame();

	t.true(lastFrame?.includes('preview'));
	t.true(lastFrame?.includes('400 lines'));
});

test('WriteFileFormatter: shows full content for small files', t => {
	const smallContent = 'Line 1\nLine 2\nLine 3';

	const lastFrame = renderWithTheme(
		<WriteFileFormatter
			args={{
				path: 'small.txt',
				content: smallContent,
			}}
		/>,
	).lastFrame();

	t.true(lastFrame?.includes('Line 1'));
	t.true(lastFrame?.includes('Line 2'));
	t.true(lastFrame?.includes('Line 3'));
	t.false(lastFrame?.includes('preview'));
});

test('executeWriteFile: calculates change statistics on overwrite', async t => {
	const testDir = createTestDir('change-stats');
	const filePath = join(testDir, 'test.txt');
	const originalContent = 'Line 1\nLine 2\nLine 3';
	const newContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';

	try {
		// Create original file
		writeFileSync(filePath, originalContent, 'utf-8');

		const result = await executeWriteFile({
			path: filePath,
			content: newContent,
		});

		t.true(result.includes('Action: File replaced'));
		t.true(result.includes('-3 lines'));
		t.true(result.includes('+5 lines'));
	} finally {
		cleanupTestDir(testDir);
	}
});

test('executeWriteFile: handles empty file creation', async t => {
	const testDir = createTestDir('empty-file');
	const filePath = join(testDir, 'empty.txt');

	try {
		const result = await executeWriteFile({
			path: filePath,
			content: '',
		});

		t.true(result.includes('Lines: 0'));
		t.true(result.includes('Size: 0 bytes'));
		t.true(result.includes('Action: New file created'));
	} finally {
		cleanupTestDir(testDir);
	}
});