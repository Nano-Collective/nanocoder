import test from 'ava';
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

	const output = lastFrame();
	t.truthy(output);
  // Truncated symbol, on newline
	t.regex(output!, /test-model/);
	t.regex(output!, /…\n/);
	t.regex(output!, /line 3\n/);
	t.regex(output!, /line 6\n/);
	t.regex(output!, /line 14\n/);

  // First few lines truncated
	t.notRegex(output!, /line 0/);
	t.notRegex(output!, /line 2/);
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

test.afterEach(() => {
	cleanup();
});
