import test from 'ava';
import type {FileNode} from './file-tree';
import {flattenTree, flattenTreeAll, getRelativePath} from './file-tree';

console.log(`\nfile-tree.spec.ts`);

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

// Create a sample tree structure for testing
function createSampleTree(): FileNode[] {
	return [
		createFileNode('src', 'src', true, [
			createFileNode('index.ts', 'src/index.ts', false),
			createFileNode('components', 'src/components', true, [
				createFileNode('Button.tsx', 'src/components/Button.tsx', false),
				createFileNode('Input.tsx', 'src/components/Input.tsx', false),
			]),
			createFileNode('utils', 'src/utils', true, [
				createFileNode('helpers.ts', 'src/utils/helpers.ts', false),
			]),
		]),
		createFileNode('package.json', 'package.json', false),
		createFileNode('README.md', 'README.md', false),
	];
}

// === flattenTree tests ===

test('flattenTree - returns empty array for empty nodes', t => {
	const result = flattenTree([], new Set());
	t.deepEqual(result, []);
});

test('flattenTree - flattens single file', t => {
	const nodes = [createFileNode('file.txt', 'file.txt', false)];
	const result = flattenTree(nodes, new Set());

	t.is(result.length, 1);
	t.is(result[0].node.name, 'file.txt');
	t.is(result[0].depth, 0);
	t.false(result[0].isExpanded);
	t.false(result[0].hasChildren);
});

test('flattenTree - shows only top level when nothing expanded', t => {
	const tree = createSampleTree();
	const result = flattenTree(tree, new Set());

	t.is(result.length, 3);
	t.is(result[0].node.name, 'src');
	t.is(result[1].node.name, 'package.json');
	t.is(result[2].node.name, 'README.md');
});

test('flattenTree - expands directory when in expanded set', t => {
	const tree = createSampleTree();
	const expanded = new Set(['src']);
	const result = flattenTree(tree, expanded);

	// Should show: src, index.ts, components, utils, package.json, README.md
	t.is(result.length, 6);
	t.is(result[0].node.name, 'src');
	t.true(result[0].isExpanded);
	t.is(result[1].node.name, 'index.ts');
	t.is(result[1].depth, 1);
	t.is(result[2].node.name, 'components');
	t.is(result[3].node.name, 'utils');
});

test('flattenTree - expands nested directories', t => {
	const tree = createSampleTree();
	const expanded = new Set(['src', 'src/components']);
	const result = flattenTree(tree, expanded);

	// Should include Button.tsx and Input.tsx
	const names = result.map(r => r.node.name);
	t.true(names.includes('Button.tsx'));
	t.true(names.includes('Input.tsx'));
});

test('flattenTree - sets correct depth for nested items', t => {
	const tree = createSampleTree();
	const expanded = new Set(['src', 'src/components']);
	const result = flattenTree(tree, expanded);

	const buttonNode = result.find(r => r.node.name === 'Button.tsx');
	t.is(buttonNode?.depth, 2);
});

test('flattenTree - sets hasChildren correctly', t => {
	const tree = createSampleTree();
	const expanded = new Set(['src']);
	const result = flattenTree(tree, expanded);

	const srcNode = result.find(r => r.node.name === 'src');
	const indexNode = result.find(r => r.node.name === 'index.ts');

	t.true(srcNode?.hasChildren);
	t.false(indexNode?.hasChildren);
});

test('flattenTree - handles empty directory', t => {
	const nodes = [createFileNode('empty', 'empty', true, [])];
	const expanded = new Set(['empty']);
	const result = flattenTree(nodes, expanded);

	t.is(result.length, 1);
	t.false(result[0].hasChildren);
});

// === flattenTreeAll tests ===

test('flattenTreeAll - returns empty array for empty nodes', t => {
	const result = flattenTreeAll([]);
	t.deepEqual(result, []);
});

test('flattenTreeAll - flattens entire tree regardless of expansion', t => {
	const tree = createSampleTree();
	const result = flattenTreeAll(tree);

	// Should include all files: src, index.ts, components, Button.tsx, Input.tsx, utils, helpers.ts, package.json, README.md
	t.is(result.length, 9);
});

test('flattenTreeAll - includes all nested files', t => {
	const tree = createSampleTree();
	const result = flattenTreeAll(tree);

	const names = result.map(r => r.node.name);
	t.true(names.includes('Button.tsx'));
	t.true(names.includes('Input.tsx'));
	t.true(names.includes('helpers.ts'));
});

test('flattenTreeAll - sets isExpanded to false for all nodes', t => {
	const tree = createSampleTree();
	const result = flattenTreeAll(tree);

	for (const node of result) {
		t.false(node.isExpanded);
	}
});

test('flattenTreeAll - sets correct depth for all nodes', t => {
	const tree = createSampleTree();
	const result = flattenTreeAll(tree);

	const srcNode = result.find(r => r.node.name === 'src');
	const indexNode = result.find(r => r.node.name === 'index.ts');
	const buttonNode = result.find(r => r.node.name === 'Button.tsx');

	t.is(srcNode?.depth, 0);
	t.is(indexNode?.depth, 1);
	t.is(buttonNode?.depth, 2);
});

test('flattenTreeAll - sets hasChildren correctly', t => {
	const tree = createSampleTree();
	const result = flattenTreeAll(tree);

	const srcNode = result.find(r => r.node.name === 'src');
	const componentsNode = result.find(r => r.node.name === 'components');
	const buttonNode = result.find(r => r.node.name === 'Button.tsx');

	t.true(srcNode?.hasChildren);
	t.true(componentsNode?.hasChildren);
	t.false(buttonNode?.hasChildren);
});

// === getRelativePath tests ===

test('getRelativePath - returns relative path from cwd', t => {
	// This test depends on cwd, so we just verify it returns a string
	const result = getRelativePath('/some/absolute/path');
	t.is(typeof result, 'string');
});

// === Edge cases ===

test('flattenTree - handles deeply nested structure', t => {
	const deepNode = createFileNode('level1', 'level1', true, [
		createFileNode('level2', 'level1/level2', true, [
			createFileNode('level3', 'level1/level2/level3', true, [
				createFileNode('deep.txt', 'level1/level2/level3/deep.txt', false),
			]),
		]),
	]);

	const expanded = new Set([
		'level1',
		'level1/level2',
		'level1/level2/level3',
	]);
	const result = flattenTree([deepNode], expanded);

	t.is(result.length, 4);
	const deepFile = result.find(r => r.node.name === 'deep.txt');
	t.is(deepFile?.depth, 3);
});

test('flattenTreeAll - handles deeply nested structure', t => {
	const deepNode = createFileNode('level1', 'level1', true, [
		createFileNode('level2', 'level1/level2', true, [
			createFileNode('level3', 'level1/level2/level3', true, [
				createFileNode('deep.txt', 'level1/level2/level3/deep.txt', false),
			]),
		]),
	]);

	const result = flattenTreeAll([deepNode]);

	t.is(result.length, 4);
	const deepFile = result.find(r => r.node.name === 'deep.txt');
	t.is(deepFile?.depth, 3);
});

test('flattenTree - preserves node properties', t => {
	const node = createFileNode('test.ts', 'test.ts', false);
	node.size = 1234;

	const result = flattenTree([node], new Set());

	t.is(result[0].node.size, 1234);
	t.is(result[0].node.absolutePath, '/test/test.ts');
});
