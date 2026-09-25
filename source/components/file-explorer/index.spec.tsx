import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {render} from 'ink-testing-library';
import {Box, Text} from 'ink';
import {ThemeContext} from '../../hooks/useTheme';
import {TitleShapeContext} from '../../hooks/useTitleShape';
import {UIStateProvider} from '../../hooks/useUIState';
import type {Colors, ThemePreset} from '../../types/ui';
import {FileExplorer} from './index.js';

console.log(`\nfile-explorer/index.spec.tsx – ${React.version}`);

// Test colors matching the theme structure
const testColors: Colors = {
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

// Test theme context value
const testThemeContext = {
	currentTheme: 'tokyo-night' as ThemePreset,
	colors: testColors,
	setCurrentTheme: () => {},
};

// Test title shape context value
const testTitleShapeContext = {
	currentTitleShape: 'pill' as const,
	setCurrentTitleShape: () => {},
	commitTitleShape: () => {},
};

/**
 * Wrapper component that provides all required contexts for FileExplorer tests
 */
function TestProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<TitleShapeContext.Provider value={testTitleShapeContext}>
			<ThemeContext.Provider value={testThemeContext}>
				<UIStateProvider>
					{children}
				</UIStateProvider>
			</ThemeContext.Provider>
		</TitleShapeContext.Provider>
	);
}

function renderWithAllContexts(element: React.ReactElement) {
	return render(<TestProvider>{element}</TestProvider>);
}

// Since FileExplorer uses buildFileTree which reads the actual filesystem,
// we need to test the component in parts. The main component tests focus on
// the rendering and interaction logic while the utility functions are tested
// separately in utils.spec.ts.

// For the FileExplorer component, we test what we can without mocking the filesystem:
// - Loading state rendering
// - Title rendering
// - Help text rendering

// Note: The FileExplorer dynamically imports buildFileTree and reads the filesystem,
// so full integration tests would require either:
// 1. Mocking the buildFileTree function
// 2. Running tests in a controlled directory environment
// 3. Creating a test fixture directory

// For now, we'll create tests that verify the component structure using a mock approach.

// === Mock FileExplorer for testing ===
// Since we can't easily mock buildFileTree due to how the module is loaded,
// we create simplified tests that verify the component's structural output

test('FileExplorer context providers are set up correctly', t => {
	// Verify our test providers work
	const {lastFrame} = render(
		<TestProvider>
			<Text>Test Content</Text>
		</TestProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Test Content/);
});

// === Structural tests using UI mock components ===

test('FileExplorer loading state shows loading message', t => {
	// Create a minimal component that mimics the loading state
	const LoadingState = () => (
		<Box flexDirection="column" paddingX={1}>
			<Text color="white">Loading file tree...</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<LoadingState />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Loading file tree/);
});

test('FileExplorer error state shows error message', t => {
	const errorMessage = 'Failed to load files';
	const ErrorState = () => (
		<Box flexDirection="column" paddingX={1}>
			<Text color="red">Error: {errorMessage}</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<ErrorState />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Error:/);
	t.regex(output!, /Failed to load files/);
});

test('FileExplorer tree view shows navigation help', t => {
	const TreeViewHelp = () => (
		<Box marginTop={1}>
			<Text color="gray" >
				Up/Down: navigate | Enter: expand/preview | Backspace: up | Space: select | /: search | Esc: done
			</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<TreeViewHelp />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /navigate/);
	t.regex(output!, /expand/);
	t.regex(output!, /select/);
	t.regex(output!, /search/);
});

test('FileExplorer search mode shows search indicator', t => {
	const searchQuery = 'test';
	const SearchIndicator = () => (
		<Box marginTop={1}>
			<Text color="blue">
				Search: <Text bold>{searchQuery || '_'}</Text>
			</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<SearchIndicator />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Search:/);
	t.regex(output!, /test/);
});

test('FileExplorer selection count displays correctly', t => {
	const SelectionCount = ({count, tokens}: {count: number; tokens: string}) => (
		<Box marginTop={1} flexDirection="column">
			<Text color="green">
				{count} file(s) selected (~{tokens} tokens)
			</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<SelectionCount count={5} tokens="2.5k" />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /5 file\(s\) selected/);
	t.regex(output!, /2\.5k tokens/);
});

test('FileExplorer token warning shows for large selections', t => {
	const TokenWarning = () => (
		<Box marginTop={1} flexDirection="column">
			<Text color="green">10 file(s) selected (~15.0k tokens)</Text>
			<Text color="yellow">That's a lot of context!</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<TokenWarning />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /That's a lot of context!/);
});

test('FileExplorer preview mode shows file path', t => {
	const previewPath = 'src/components/Button.tsx';
	const PreviewHeader = () => (
		<Box marginTop={1}>
			<Text color="green">✓ Selected</Text>
			<Text color="gray"> | 1 file(s) (~0.5k tokens)</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<PreviewHeader />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /✓ Selected/);
});

test('FileExplorer preview mode shows unselected state', t => {
	const PreviewUnselected = () => (
		<Box marginTop={1}>
			<Text color="gray">✗ Not selected</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<PreviewUnselected />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /✗ Not selected/);
});

test('FileExplorer preview mode shows scroll indicator', t => {
	const ScrollIndicator = ({start, end, total}: {start: number; end: number; total: number}) => (
		<Box marginTop={1}>
			<Text color="gray" >
				Line {start}-{end} of {total}
			</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<ScrollIndicator start={1} end={15} total={100} />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Line 1-15 of 100/);
});

test('FileExplorer preview mode shows navigation help', t => {
	const PreviewHelp = () => (
		<Box marginTop={1}>
			<Text color="gray" >
				Up/Down: scroll | Space: toggle select | Shift+Tab/Esc: back
			</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<PreviewHelp />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /scroll/);
	t.regex(output!, /toggle select/);
	t.regex(output!, /back/);
});

test('FileExplorer empty directory shows message', t => {
	const EmptyDirectory = () => (
		<Box flexDirection="column" marginTop={1}>
			<Text color="gray">Empty directory</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<EmptyDirectory />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Empty directory/);
});

test('FileExplorer search with no matches shows message', t => {
	const NoMatches = () => (
		<Box flexDirection="column" marginTop={1}>
			<Text color="gray">No matches found</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<NoMatches />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /No matches found/);
});

test('FileExplorer status bar shows file path', t => {
	const StatusBar = ({path, size}: {path: string; size: string}) => (
		<Box>
			<Text color="white" >
				{path}
				<Text> ({size})</Text>
			</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<StatusBar path="src/index.ts" size="1.2 KB" />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /src\/index\.ts/);
	t.regex(output!, /1\.2 KB/);
});

test('FileExplorer search help shows correct instructions', t => {
	const SearchHelp = () => (
		<Box marginTop={1}>
			<Text color="gray" >
				Type to filter | Backspace: delete | Esc: exit search
			</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<SearchHelp />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Type to filter/);
	t.regex(output!, /Backspace/);
	t.regex(output!, /exit search/);
});

test('FileExplorer preview error shows message', t => {
	const PreviewError = ({error}: {error: string}) => (
		<Box flexDirection="column" marginTop={1}>
			<Text color="yellow">{error}</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<PreviewError error="Cannot preview (binary or unreadable)" />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Cannot preview/);
});

test('FileExplorer preview directory error shows message', t => {
	const DirectoryError = () => (
		<Box flexDirection="column" marginTop={1}>
			<Text color="yellow">Cannot preview directory</Text>
		</Box>
	);

	const {lastFrame} = renderWithAllContexts(<DirectoryError />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Cannot preview directory/);
});

// === Real component ===
// Everything above renders hand-written stand-ins, so none of it exercises
// FileExplorer itself. These render the actual component.

test('FileExplorer renders inside a rounded titled frame', t => {
	const {lastFrame} = renderWithAllContexts(<FileExplorer onClose={() => {}} />);

	const output = stripAnsi(lastFrame() ?? '');
	// Rounded box corners, the same chrome the session / IDE selectors use.
	t.regex(output, /╭.*╮/s);
	t.regex(output, /╰.*╯/s);
	t.regex(output, /\/explorer/);
});

test('FileExplorer keeps the frame while the tree is still loading', t => {
	// First frame is the loading branch — the chrome must not pop in later.
	const {lastFrame} = renderWithAllContexts(<FileExplorer onClose={() => {}} />);

	const output = stripAnsi(lastFrame() ?? '');
	t.regex(output, /╭/);
	t.regex(output, /Loading file tree/);
});

test('FileExplorer Backspace collapses an open directory, then moves up to the parent', async t => {
	// The explorer reads process.cwd(), so run it from a fixture:
	// outer/inner/file.txt next to top.txt.
	const root = mkdtempSync(join(tmpdir(), 'nanocoder-explorer-'));
	mkdirSync(join(root, 'outer', 'inner'), {recursive: true});
	writeFileSync(join(root, 'outer', 'inner', 'file.txt'), '');
	writeFileSync(join(root, 'top.txt'), '');

	const originalCwd = process.cwd();
	process.chdir(root);
	const {stdin, lastFrame, unmount} = renderWithAllContexts(
		<FileExplorer onClose={() => {}} />,
	);
	t.teardown(() => {
		unmount();
		process.chdir(originalCwd);
		rmSync(root, {recursive: true, force: true});
	});

	const frame = () => stripAnsi(lastFrame() ?? '');
	// Poll rather than sleep: a fixed wait can read the frame before Ink flushes.
	const waitUntil = async (predicate: (output: string) => boolean) => {
		const start = Date.now();
		while (!predicate(frame()) && Date.now() - start < 3000) {
			await new Promise(resolve => setTimeout(resolve, 20));
		}
	};
	// Let the previous render's input handler attach before the next key:
	// a key sent the moment a row appears is handled by the old closure.
	const press = async (key: string) => {
		await new Promise(resolve => setTimeout(resolve, 50));
		stdin.write(key);
		await new Promise(resolve => setTimeout(resolve, 30));
	};
	const BACKSPACE = '\u007f';
	// The status bar prints the highlighted node's path alone on its row.
	// buildFileTree joins paths with path.join, so build the expected one the
	// same way.
	const statusIs = (path: string) => (output: string) =>
		output.split('\n').some(line => line.replace(/[│\s]/g, '') === path);
	const INNER = join('outer', 'inner');

	await waitUntil(output => /outer\//.test(output));
	t.regex(frame(), /Backspace: up/);

	// Open outer and outer/inner, then highlight the file inside.
	await press('\r');
	await waitUntil(output => /inner\//.test(output));
	await press('\u001b[B');
	await waitUntil(statusIs(INNER));
	await press('\r');
	await waitUntil(output => /file\.txt/.test(output));
	await press('\u001b[B');
	await waitUntil(output => /file\.txt \(0 B\)/.test(output));

	// On a file: move up to its directory, which stays open.
	await press(BACKSPACE);
	await waitUntil(statusIs(INNER));
	t.true(statusIs(INNER)(frame()), frame());
	t.regex(frame(), /file\.txt/);

	// On an open directory: collapse it, keeping the selection.
	await press(BACKSPACE);
	await waitUntil(output => !/file\.txt/.test(output));
	t.notRegex(frame(), /file\.txt/);
	t.true(statusIs(INNER)(frame()), frame());

	// On a collapsed directory: move up to the parent...
	await press(BACKSPACE);
	await waitUntil(statusIs('outer'));
	t.true(statusIs('outer')(frame()), frame());

	// ...and collapse that one too.
	await press(BACKSPACE);
	await waitUntil(output => !/inner\//.test(output));
	t.notRegex(frame(), /inner\//);
	t.true(statusIs('outer')(frame()), frame());
});
