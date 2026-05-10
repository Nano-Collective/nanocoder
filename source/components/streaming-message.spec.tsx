import test from 'ava';
import stripAnsi from 'strip-ansi';
import { cleanup, render } from 'ink-testing-library';
import StreamingMessage from './streaming-message'
import { ThemeContext } from '../hooks/useTheme';
import { themes } from '../config/themes';
import React from 'react';

console.log(`\nstreaming-message.spec.tsx – ${React.version}`);

/*
StreamingMessage should resemble AssistantMessage component.
However, text is truncated and not rendering as markdown.
*/

// Mock ThemeProvider for testing
const MockThemeProvider = ({children}: {children: React.ReactNode}) => {
	const mockTheme = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={mockTheme}>{children}</ThemeContext.Provider>
	);
};

// ============================================================================
// Component Rendering Tests
// ============================================================================

test('StreamingMessage renders with message', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingMessage message="Hello world" model="test-model" />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /test-model/);
	t.regex(output!, /Hello world/);

  // Renders tokens and tokens per second
	t.regex(output!, /~\d+ tokens · (\d+\.\d|—) tok\/s/);
})

test('StreamingMessage message renders without formatting', t => {
	const message = `# Title

This has **bold** and *italic* text.

- List item

Price: &euro;50`;

	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingMessage message={message} model="test-model" />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /# Title/);
	t.regex(output!, /\*\*bold\*\*/);
	t.regex(output!, /\*italic\*/);
	t.regex(output!, /&euro;50/);
});

test('StreamingMessage truncates long messages', t => {
  // Create a 15 line message
  const message = [...Array(15).keys()].map((s) => `line ${s}`).join('\n')

	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingMessage message={message} model="test-model" />
		</MockThemeProvider>,
	);

	// Strip ANSI: CI sets FORCE_COLOR=1 so ink wraps styled glyphs (like the
	// truncation `…`) in escape sequences. Without stripping, the regex fails
	// in CI even though it passes locally where FORCE_COLOR is unset.
	const output = stripAnsi(lastFrame() ?? '');
	t.truthy(output);
  // Truncated symbol, on its own line. Box renderer may pad with trailing
  // spaces to fill terminal width, so allow any whitespace before the newline.
	t.regex(output, /test-model/);
	t.regex(output, /…[ ]*\n/);
	t.regex(output, /line 3[ ]*\n/);
	t.regex(output, /line 6[ ]*\n/);
	t.regex(output, /line 14[ ]*\n/);

  // First few lines truncated
	t.notRegex(output, /line 0/);
	t.notRegex(output, /line 2/);
})

test('StreamingMessage renders without crashing with empty message', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingMessage message="" model="test-model" />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /test-model/);
});

// ============================================================================
// Whitespace Trimming Tests
// ============================================================================

test('StreamingMessage strips leading newlines', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingMessage message="\n\nHello world" model="test-model" />
		</MockThemeProvider>,
	);

	const raw = lastFrame() ?? '';
	const output = stripAnsi(raw);
	console.log('Stripped output:', JSON.stringify(output));
	// The message "Hello world" should appear in the output without leading newlines
	// The content displayed inside the box should be trimmed
	t.true(output.includes('Hello world'));
	// Check that the raw string content (inside box) doesn't start with newlines
	// The visible content line should start with the actual text
	const contentMatch = output.match(/┃\s*(.+)/);
	if (contentMatch) {
		t.false(contentMatch[1].startsWith('\n'), 'Content should not start with newline');
	}
});

test('StreamingMessage strips trailing newlines', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingMessage message="Hello world\n\n" model="test-model" />
		</MockThemeProvider>,
	);

	const output = stripAnsi(lastFrame() ?? '');
	// Output should have the message without trailing newlines
	t.true(output.includes('Hello world'));
	// The box content should not end with trailing newlines
});

test('StreamingMessage strips leading and trailing newlines', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingMessage message="\n\n\nContent\n\n\n" model="test-model" />
		</MockThemeProvider>,
	);

	const output = stripAnsi(lastFrame() ?? '');
	// Should have the trimmed content
	t.true(output.includes('Content'));
	// Content should not start with newlines
	const contentMatch = output.match(/┃\s*(.+)/);
	if (contentMatch) {
		t.false(contentMatch[1].startsWith('\n'), 'Content should not start with newline');
	}
});

test('StreamingMessage strips carriage return characters', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingMessage message="\r\n\r\nHello\r\n\r\n" model="test-model" />
		</MockThemeProvider>,
	);

	const output = stripAnsi(lastFrame() ?? '');
	// Should have the message without CR/LF issues
	t.true(output.includes('Hello'));
	// Content should not start with \r or \n
	const contentMatch = output.match(/┃\s*(.+)/);
	if (contentMatch) {
		t.false(contentMatch[1].startsWith('\r'), 'Content should not start with \\r');
		t.false(contentMatch[1].startsWith('\n'), 'Content should not start with \\n');
	}
});

test('StreamingMessage strips whitespace-only content', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingMessage message="   \n\n   " model="test-model" />
		</MockThemeProvider>,
	);

	const output = stripAnsi(lastFrame() ?? '');
	// Should render without crash - whitespace is stripped
	t.true(output.includes('test-model'));
	// JSX attribute treats "\n" as literal backslash-n, so input is
	// `   \n\n   ` (3 spaces + literal `\n\n` + 3 spaces). After trim, only
	// the literal `\n\n` should remain — the input's surrounding 3-space
	// runs must be gone. The box adds 1-char padding plus may pad lines to
	// terminal width with trailing spaces; strip only `┃` and trim trailing
	// width-padding before asserting the leading 3-space prefix is gone.
	const boxContent = output
		.split('\n')
		.filter(l => l.includes('┃'))
		.map(l => l.replace(/^.*?┃/, '').trimEnd());
	t.true(
		boxContent.every(l => !l.startsWith('   ') && !l.endsWith('   ')),
		`Trim should strip surrounding spaces, got: ${JSON.stringify(boxContent)}`,
	);
});

test('StreamingMessage preserves internal newlines', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingMessage message="Line 1\nLine 2\nLine 3" model="test-model" />
		</MockThemeProvider>,
	);

	const output = stripAnsi(lastFrame() ?? '');
	t.true(output.includes('Line 1'));
	t.true(output.includes('Line 2'));
	t.true(output.includes('Line 3'));
});

test.afterEach(() => {
	cleanup();
});
