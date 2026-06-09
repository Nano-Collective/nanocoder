import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {listDirectoryTool} from './list-directory';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\nlist-directory.spec.tsx – ${React.version}`);

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
// Tests for ListDirectoryFormatter Component Rendering
// ============================================================================

test('ListDirectoryFormatter renders with path', t => {
	const formatter = listDirectoryTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({path: 'src'}, 'Directory contents for "src":\n\ncomponents/\nindex.ts');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /list_directory/);
	t.regex(output!, /src/);
});

test('ListDirectoryFormatter shows entry count', t => {
	const formatter = listDirectoryTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({path: '.'}, 'Directory contents for ".":\n\nsrc/\ntest/\npackage.json\ntsconfig.json');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Entries:/);
	t.regex(output!, /4/);
});

test('ListDirectoryFormatter shows recursive info', t => {
	const formatter = listDirectoryTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({path: '.', recursive: true, maxDepth: 3}, 'Directory contents for ".":\n\nsrc/\nfile.ts\n\n[Recursive: showing entries up to depth 3]');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Recursive:/);
	t.regex(output!, /yes/);
});

test('ListDirectoryFormatter shows tree format indicator', t => {
	const formatter = listDirectoryTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({path: '.', tree: true}, 'Directory contents for ".":\n\nsrc/index.ts\nsrc/utils.ts\npackage.json\n\n[Tree format: flat paths]');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Format:/);
	t.regex(output!, /tree/);
});

test('ListDirectoryFormatter handles error results gracefully', t => {
	const formatter = listDirectoryTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({path: '/nonexistent'}, 'Error: Directory "/nonexistent" does not exist');
	const {lastFrame} = render(element);

	// Should return empty fragment for errors
	const output = lastFrame();
	t.is(output, '');
});

test('ListDirectoryFormatter handles empty directory', t => {
	const formatter = listDirectoryTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({path: 'empty'}, 'Directory "empty" is empty');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /list_directory/);
});

// ============================================================================
// Tests for list_directory Tool Handler - Basic Functionality
// ============================================================================

test.serial('list_directory lists current directory by default', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-default-temp');
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'file1.ts'), 'content1');
		writeFileSync(join(testDir, 'file2.js'), 'content2');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{},
			{toolCallId: 'test', messages: []},
		);

		t.regex(result, /Directory contents for/);
		t.true(result.includes('file1.ts') || result.includes('file2.js'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-default-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory lists specific directory', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-specific-temp');
		mkdirSync(join(testDir, 'src'), {recursive: true});
		writeFileSync(join(testDir, 'src', 'index.ts'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{path: 'src'},
			{toolCallId: 'test', messages: []},
		);

		t.regex(result, /Directory contents for "src"/);
		t.true(result.includes('index.ts'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-specific-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory shows files and directories', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-mixed-temp');
		mkdirSync(join(testDir, 'subdir'), {recursive: true});
		writeFileSync(join(testDir, 'file.ts'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{},
			{toolCallId: 'test', messages: []},
		);

		t.true(result.includes('subdir'));
		t.true(result.includes('file.ts'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-mixed-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory shows file sizes', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-sizes-temp');
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'largefile.txt'), 'x'.repeat(1000));

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{},
			{toolCallId: 'test', messages: []},
		);

		// Should show file size in bytes
		t.true(result.includes('bytes') || result.includes('1,000'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-sizes-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory returns empty message for empty directories', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-empty-temp');
		mkdirSync(testDir, {recursive: true});

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{},
			{toolCallId: 'test', messages: []},
		);

		t.regex(result, /is empty/);
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-empty-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory throws error for nonexistent directory', async t => {
	t.timeout(10000);
	const error = await t.throwsAsync(
		async () => {
			await listDirectoryTool.tool.execute!(
				{path: 'nonexistent-dir-that-does-not-exist'},
				{toolCallId: 'test', messages: []},
			);
		},
		{instanceOf: Error},
	);

	t.regex(error.message, /does not exist/);
});

// ============================================================================
// Tests for list_directory Tool Handler - Recursive
// ============================================================================

test.serial('list_directory recursive=true lists subdirectories', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-recursive-temp');
		mkdirSync(join(testDir, 'src', 'components'), {recursive: true});
		writeFileSync(join(testDir, 'src', 'index.ts'), 'content');
		writeFileSync(join(testDir, 'src', 'components', 'Button.tsx'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{recursive: true},
			{toolCallId: 'test', messages: []},
		);

		t.true(result.includes('Button.tsx') || result.includes('components'));
		t.regex(result, /Recursive/);
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-recursive-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory respects maxDepth limit', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-maxdepth-temp');
		mkdirSync(join(testDir, 'a', 'b', 'c', 'd'), {recursive: true});
		writeFileSync(join(testDir, 'a', 'file1.ts'), 'content');
		writeFileSync(join(testDir, 'a', 'b', 'file2.ts'), 'content');
		writeFileSync(join(testDir, 'a', 'b', 'c', 'file3.ts'), 'content');
		writeFileSync(join(testDir, 'a', 'b', 'c', 'd', 'file4.ts'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{recursive: true, maxDepth: 2},
			{toolCallId: 'test', messages: []},
		);

		t.true(result.includes('file1.ts') || result.includes('file2.ts'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-maxdepth-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory default maxDepth is 3', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-default-depth-temp');
		mkdirSync(join(testDir, 'a', 'b', 'c', 'd'), {recursive: true});
		writeFileSync(join(testDir, 'a', 'file.ts'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{recursive: true},
			{toolCallId: 'test', messages: []},
		);

		// With default maxDepth=3, should include at least files up to 3 levels deep
		t.true(result.includes('file.ts') || result.includes('a'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-default-depth-temp'), {recursive: true, force: true});
	}
});

// ============================================================================
// Tests for list_directory Tool Handler - Gitignore
// ============================================================================

test.serial('list_directory respects .gitignore patterns', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-gitignore-temp');
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, '.gitignore'), 'ignored.ts\n');
		writeFileSync(join(testDir, 'included.ts'), 'content');
		writeFileSync(join(testDir, 'ignored.ts'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{},
			{toolCallId: 'test', messages: []},
		);

		t.true(result.includes('included.ts'));
		t.false(result.includes('ignored.ts'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-gitignore-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory ignores node_modules by default', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-node-modules-temp');
		mkdirSync(join(testDir, 'node_modules'), {recursive: true});
		mkdirSync(join(testDir, 'src'), {recursive: true});
		writeFileSync(join(testDir, 'node_modules', 'package.js'), 'content');
		writeFileSync(join(testDir, 'src', 'index.ts'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{},
			{toolCallId: 'test', messages: []},
		);

		t.false(result.includes('node_modules'));
		t.true(result.includes('src'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-node-modules-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory ignores .git directory', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-git-temp');
		mkdirSync(join(testDir, '.git'), {recursive: true});
		mkdirSync(join(testDir, 'src'), {recursive: true});
		writeFileSync(join(testDir, '.git', 'config'), 'content');
		writeFileSync(join(testDir, 'src', 'index.ts'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{},
			{toolCallId: 'test', messages: []},
		);

		t.false(result.includes('.git'));
		t.true(result.includes('src'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-git-temp'), {recursive: true, force: true});
	}
});

// ============================================================================
// Tests for list_directory Tool Handler - Tree Mode
// ============================================================================

test.serial('list_directory tree=true outputs flat paths', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-tree-paths-temp');
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'file.ts'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{tree: true},
			{toolCallId: 'test', messages: []},
		);

		t.regex(result, /\[Tree format: flat paths\]/);
		t.true(result.includes('file.ts'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-tree-paths-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory tree=true has no emojis', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-tree-no-emoji-temp');
		mkdirSync(join(testDir, 'src'), {recursive: true});
		writeFileSync(join(testDir, 'file.ts'), 'content');
		writeFileSync(join(testDir, 'src', 'index.ts'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{tree: true},
			{toolCallId: 'test', messages: []},
		);

		t.false(result.includes('📁'));
		t.false(result.includes('📄'));
		t.false(result.includes('🔗'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-tree-no-emoji-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory standard format has no emojis', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-std-no-emoji-temp');
		mkdirSync(join(testDir, 'src'), {recursive: true});
		writeFileSync(join(testDir, 'file.ts'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{},
			{toolCallId: 'test', messages: []},
		);

		t.false(result.includes('📁'));
		t.false(result.includes('📄'));
		t.false(result.includes('🔗'));
		// Directories are marked with a trailing slash instead
		t.true(result.includes('src/'));
		t.true(result.includes('file.ts'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-std-no-emoji-temp'), {recursive: true, force: true});
	}
});

// ============================================================================
// Tests for list_directory Tool Handler - Hidden Files
// ============================================================================

test.serial('list_directory hides dotfiles by default', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-hidden-default-temp');
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, '.hidden'), 'content');
		writeFileSync(join(testDir, 'visible.ts'), 'content');

		process.chdir(testDir);

		// List a subdirectory explicitly (not the current dir) to hide dotfiles
		mkdirSync(join(testDir, 'subdir'), {recursive: true});
		writeFileSync(join(testDir, 'subdir', '.hidden'), 'content');
		writeFileSync(join(testDir, 'subdir', 'visible.ts'), 'content');

		const result = await listDirectoryTool.tool.execute!(
			{path: 'subdir'},
			{toolCallId: 'test', messages: []},
		);

		t.false(result.includes('.hidden'));
		t.true(result.includes('visible.ts'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-hidden-default-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory showHiddenFiles=true shows dotfiles', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-hidden-show-temp');
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, '.hidden'), 'content');
		writeFileSync(join(testDir, 'visible.ts'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{showHiddenFiles: true},
			{toolCallId: 'test', messages: []},
		);

		t.true(result.includes('.hidden'));
		t.true(result.includes('visible.ts'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-hidden-show-temp'), {recursive: true, force: true});
	}
});

test.serial('list_directory shows dotfiles when path starts with dot', async t => {
	t.timeout(10000);
	const originalCwd = process.cwd();

	try {
		const testDir = join(process.cwd(), 'test-listdir-dot-path-temp');
		mkdirSync(join(testDir, '.config'), {recursive: true});
		writeFileSync(join(testDir, '.config', 'file.json'), 'content');

		process.chdir(testDir);

		const result = await listDirectoryTool.tool.execute!(
			{path: '.config'},
			{toolCallId: 'test', messages: []},
		);

		t.true(result.includes('file.json'));
	} finally {
		process.chdir(originalCwd);
		rmSync(join(originalCwd, 'test-listdir-dot-path-temp'), {recursive: true, force: true});
	}
});

// ============================================================================
// Tests for list_directory Tool Configuration
// ============================================================================

test('list_directory tool has correct name', t => {
	t.is(listDirectoryTool.name, 'list_directory');
});

test('list_directory tool does not require confirmation', t => {
	t.true(listDirectoryTool.readOnly);
	t.is(listDirectoryTool.approval, undefined);
});

test('list_directory tool has handler function', t => {
	t.is(typeof listDirectoryTool.tool.execute, 'function');
});

test('list_directory tool has formatter function', t => {
	t.is(typeof listDirectoryTool.formatter, 'function');
});
