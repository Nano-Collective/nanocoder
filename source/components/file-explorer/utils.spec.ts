import test from 'ava';
import type {FileNode} from '@/utils/file-tree';
import {
	formatSize,
	formatTokens,
	getAllFilesInDirectory,
	getLanguageFromPath,
} from './utils';

console.log(`\nfile-explorer/utils.spec.ts`);

// Helper to create test file nodes
function createFileNode(
	name: string,
	path: string,
	isDirectory: boolean,
	children?: FileNode[],
): FileNode {
	return {
		name,
		path,
		absolutePath: `/test/${path}`,
		isDirectory,
		size: isDirectory ? undefined : 100,
		children,
	};
}

// === getAllFilesInDirectory tests ===

test('getAllFilesInDirectory - returns single file path for file node', t => {
	const node = createFileNode('test.ts', 'test.ts', false);
	const result = getAllFilesInDirectory(node);

	t.deepEqual(result, ['test.ts']);
});

test('getAllFilesInDirectory - returns empty array for empty directory', t => {
	const node = createFileNode('empty', 'empty', true, []);
	const result = getAllFilesInDirectory(node);

	t.deepEqual(result, []);
});

test('getAllFilesInDirectory - returns all files in flat directory', t => {
	const node = createFileNode('src', 'src', true, [
		createFileNode('index.ts', 'src/index.ts', false),
		createFileNode('app.ts', 'src/app.ts', false),
	]);
	const result = getAllFilesInDirectory(node);

	t.deepEqual(result, ['src/index.ts', 'src/app.ts']);
});

test('getAllFilesInDirectory - returns files from nested directories', t => {
	const node = createFileNode('src', 'src', true, [
		createFileNode('index.ts', 'src/index.ts', false),
		createFileNode('components', 'src/components', true, [
			createFileNode('Button.tsx', 'src/components/Button.tsx', false),
			createFileNode('Input.tsx', 'src/components/Input.tsx', false),
		]),
	]);
	const result = getAllFilesInDirectory(node);

	t.is(result.length, 3);
	t.true(result.includes('src/index.ts'));
	t.true(result.includes('src/components/Button.tsx'));
	t.true(result.includes('src/components/Input.tsx'));
});

test('getAllFilesInDirectory - handles deeply nested structure', t => {
	const node = createFileNode('level1', 'level1', true, [
		createFileNode('level2', 'level1/level2', true, [
			createFileNode('level3', 'level1/level2/level3', true, [
				createFileNode('deep.txt', 'level1/level2/level3/deep.txt', false),
			]),
		]),
	]);
	const result = getAllFilesInDirectory(node);

	t.deepEqual(result, ['level1/level2/level3/deep.txt']);
});

test('getAllFilesInDirectory - handles directory without children property', t => {
	const node: FileNode = {
		name: 'dir',
		path: 'dir',
		absolutePath: '/test/dir',
		isDirectory: true,
		// children is undefined
	};
	const result = getAllFilesInDirectory(node);

	t.deepEqual(result, []);
});

// === getLanguageFromPath tests ===

test('getLanguageFromPath - returns javascript for .js files', t => {
	t.is(getLanguageFromPath('file.js'), 'javascript');
	t.is(getLanguageFromPath('path/to/file.js'), 'javascript');
});

test('getLanguageFromPath - returns typescript for .ts files', t => {
	t.is(getLanguageFromPath('file.ts'), 'typescript');
	t.is(getLanguageFromPath('file.tsx'), 'typescript');
});

test('getLanguageFromPath - handles various extensions', t => {
	t.is(getLanguageFromPath('file.py'), 'python');
	t.is(getLanguageFromPath('file.json'), 'json');
	t.is(getLanguageFromPath('file.css'), 'css');
	t.is(getLanguageFromPath('file.html'), 'html');
	t.is(getLanguageFromPath('file.md'), 'markdown');
});

test('getLanguageFromPath - is case insensitive for extensions', t => {
	t.is(getLanguageFromPath('file.JS'), 'javascript');
	t.is(getLanguageFromPath('file.TS'), 'typescript');
	t.is(getLanguageFromPath('file.PY'), 'python');
});

test('getLanguageFromPath - returns dockerfile for Dockerfile', t => {
	t.is(getLanguageFromPath('Dockerfile'), 'dockerfile');
	t.is(getLanguageFromPath('path/to/Dockerfile'), 'dockerfile');
});

test('getLanguageFromPath - returns makefile for Makefile', t => {
	t.is(getLanguageFromPath('Makefile'), 'makefile');
	t.is(getLanguageFromPath('path/to/Makefile'), 'makefile');
});

test('getLanguageFromPath - returns plaintext for unknown extensions', t => {
	t.is(getLanguageFromPath('file.xyz'), 'plaintext');
	t.is(getLanguageFromPath('file.unknown'), 'plaintext');
});

test('getLanguageFromPath - returns plaintext for files without extension', t => {
	t.is(getLanguageFromPath('somefile'), 'plaintext');
});

// === formatTokens tests ===

test('formatTokens - returns raw number for values under 1000', t => {
	t.is(formatTokens(0), '0');
	t.is(formatTokens(1), '1');
	t.is(formatTokens(500), '500');
	t.is(formatTokens(999), '999');
});

test('formatTokens - formats thousands with k suffix', t => {
	t.is(formatTokens(1000), '1.0k');
	t.is(formatTokens(1500), '1.5k');
	t.is(formatTokens(10000), '10.0k');
	t.is(formatTokens(999999), '1000.0k');
});

test('formatTokens - formats millions with M suffix', t => {
	t.is(formatTokens(1000000), '1.0M');
	t.is(formatTokens(1500000), '1.5M');
	t.is(formatTokens(10000000), '10.0M');
});

// === formatSize tests ===

test('formatSize - returns bytes for values under 1KB', t => {
	t.is(formatSize(0), '0 B');
	t.is(formatSize(1), '1 B');
	t.is(formatSize(500), '500 B');
	t.is(formatSize(1023), '1023 B');
});

test('formatSize - formats kilobytes correctly', t => {
	t.is(formatSize(1024), '1.0 KB');
	t.is(formatSize(1536), '1.5 KB');
	t.is(formatSize(10240), '10.0 KB');
});

test('formatSize - formats megabytes correctly', t => {
	t.is(formatSize(1024 * 1024), '1.0 MB');
	t.is(formatSize(1.5 * 1024 * 1024), '1.5 MB');
	t.is(formatSize(10 * 1024 * 1024), '10.0 MB');
});
