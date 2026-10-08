import test from 'ava';
import React from 'react';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {FlatNode} from '@/utils/file-tree';
import type {FileNode} from '@/utils/file-tree';
import {TreeItem} from './tree-item';

console.log(`\ntree-item.spec.tsx – ${React.version}`);

// Test colors matching the theme structure
const testColors = {
	primary: 'blue',
	secondary: 'gray',
	text: 'white',
	base: 'black',
	info: 'cyan',
	warning: 'yellow',
	error: 'red',
	success: 'green',
	tool: 'magenta',
	diffAdded: 'green',
	diffRemoved: 'red',
	diffAddedText: 'text',
	diffRemovedText: 'text',
};

// Helper to create file nodes
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

// Helper to create flat node
function createFlatNode(
	name: string,
	path: string,
	isDirectory: boolean,
	depth = 0,
	isExpanded = false,
	hasChildren = false,
	children?: FileNode[],
): FlatNode {
	return {
		node: createFileNode(name, path, isDirectory, children),
		depth,
		isExpanded,
		hasChildren,
	};
}

// === File rendering tests ===

test('TreeItem renders file with correct name', t => {
	const item = createFlatNode('test.ts', 'test.ts', false);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={false}
			isSelected={false}
			selectedFiles={new Set()}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /test\.ts/);
});

test('TreeItem renders selected file with checkmark', t => {
	const item = createFlatNode('selected.ts', 'selected.ts', false);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={false}
			isSelected={true}
			selectedFiles={new Set(['selected.ts'])}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /✓/);
	t.regex(output!, /selected\.ts/);
});

test('TreeItem renders unselected file without checkmark', t => {
	const item = createFlatNode('unselected.ts', 'unselected.ts', false);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={false}
			isSelected={false}
			selectedFiles={new Set()}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /✓/);
});

test('TreeItem renders highlighted file', t => {
	const item = createFlatNode('highlighted.ts', 'highlighted.ts', false);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={true}
			isSelected={false}
			selectedFiles={new Set()}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /highlighted\.ts/);
});

// === Directory rendering tests ===

test('TreeItem renders directory with trailing slash', t => {
	const item = createFlatNode('src', 'src', true, 0, false, true, [
		createFileNode('index.ts', 'src/index.ts', false),
	]);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={false}
			isSelected={false}
			selectedFiles={new Set()}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /src\//);
});

test('TreeItem renders collapsed directory with > prefix', t => {
	const item = createFlatNode('src', 'src', true, 0, false, true, [
		createFileNode('index.ts', 'src/index.ts', false),
	]);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={false}
			isSelected={false}
			selectedFiles={new Set()}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, />/);
});

test('TreeItem renders expanded directory with v prefix', t => {
	const item = createFlatNode('src', 'src', true, 0, true, true, [
		createFileNode('index.ts', 'src/index.ts', false),
	]);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={false}
			isSelected={false}
			selectedFiles={new Set()}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /v/);
});

test('TreeItem renders empty directory without expand indicator', t => {
	const item = createFlatNode('empty', 'empty', true, 0, false, false, []);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={false}
			isSelected={false}
			selectedFiles={new Set()}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /empty\//);
	t.notRegex(output!, /[>v]/);
});

// === Directory selection state tests ===

test('TreeItem renders fully selected directory with checkmark', t => {
	const item = createFlatNode('src', 'src', true, 0, false, true, [
		createFileNode('index.ts', 'src/index.ts', false),
		createFileNode('app.ts', 'src/app.ts', false),
	]);
	const selectedFiles = new Set(['src/index.ts', 'src/app.ts']);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={false}
			isSelected={false}
			selectedFiles={selectedFiles}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /✓/);
});

test('TreeItem renders partially selected directory with half-filled icon', t => {
	const item = createFlatNode('src', 'src', true, 0, false, true, [
		createFileNode('index.ts', 'src/index.ts', false),
		createFileNode('app.ts', 'src/app.ts', false),
	]);
	const selectedFiles = new Set(['src/index.ts']); // Only one of two files
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={false}
			isSelected={false}
			selectedFiles={selectedFiles}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /◐/);
});

test('TreeItem renders unselected directory with expand indicator', t => {
	const item = createFlatNode('src', 'src', true, 0, false, true, [
		createFileNode('index.ts', 'src/index.ts', false),
	]);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={false}
			isSelected={false}
			selectedFiles={new Set()}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, />/);
	t.notRegex(output!, /[✓◐]/);
});

// === Indentation tests ===

test('TreeItem renders with correct indentation for depth 0', t => {
	const item = createFlatNode('root.ts', 'root.ts', false, 0);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={false}
			isSelected={false}
			selectedFiles={new Set()}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	// At depth 0, should have minimal indentation
	t.regex(output!, /root\.ts/);
});

test('TreeItem renders with correct indentation for nested files', t => {
	const item = createFlatNode('deep.ts', 'a/b/deep.ts', false, 2);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={false}
			isSelected={false}
			selectedFiles={new Set()}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	// At depth 2, should have more indentation (4 spaces)
	t.regex(output!, /deep\.ts/);
});

// === Combined state tests ===

test('TreeItem renders highlighted and selected file correctly', t => {
	const item = createFlatNode('both.ts', 'both.ts', false);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={true}
			isSelected={true}
			selectedFiles={new Set(['both.ts'])}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /✓/);
	t.regex(output!, /both\.ts/);
});

test('TreeItem renders highlighted directory with selection correctly', t => {
	const item = createFlatNode('src', 'src', true, 0, true, true, [
		createFileNode('index.ts', 'src/index.ts', false),
	]);
	const selectedFiles = new Set(['src/index.ts']);
	const {lastFrame} = renderWithTheme(
		<TreeItem
			item={item}
			isHighlighted={true}
			isSelected={false}
			selectedFiles={selectedFiles}
			colors={testColors}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /src\//);
	t.regex(output!, /✓/);
});
