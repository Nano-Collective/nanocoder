import test from 'ava';
import { cleanup, render } from 'ink-testing-library';
import React from 'react';
import { themes } from '../config/themes';
import { ThemeContext } from '../hooks/useTheme';
import StreamingReasoning from './streaming-reasoning';

console.log(`\nstreaming-reasoning.spec.tsx – ${React.version}`);

/*
StreamingReasoning should resemble AssistantReasoning component.
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

test('StreamingReasoning expanded renders with message', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingReasoning reasoning="Hello world" compact={false} startTime={Date.now()} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Thinking/);
	t.regex(output!, /Hello world/);

  // Renders tokens and tokens per second
	t.regex(output!, /~\d+ tokens · (\d+\.\d|—) tok\/s/);
})

test('StreamingReasoning compacted renders without message', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingReasoning reasoning="Hello world" compact={true} startTime={Date.now()} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Thinking/);

	// No token count or message
	t.notRegex(output!, /~\d+ tokens · (\d+\.\d|—) tok\/s/);
	t.notRegex(output!, /Hello world/);
});

test('StreamingReasoning message renders without formatting', t => {
	const message = `# Title

This has **bold** and *italic* text.

- List item

Price: &euro;50`;

	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingReasoning reasoning={message} compact={false} startTime={Date.now()} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /# Title/);
	t.regex(output!, /\*\*bold\*\*/);
	t.regex(output!, /\*italic\*/);
	t.regex(output!, /&euro;50/);
});

test('StreamingReasoning truncates long messages', t => {
  // Create a 15 line message
  const message = [...Array(15).keys()].map((s) => `line ${s}`).join('\n')

	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingReasoning reasoning={message} compact={false} startTime={Date.now()} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
  // Truncated symbol, on newline
	t.regex(output!, /Thinking/);
	t.regex(output!, /…\n/);
	t.regex(output!, /line 3\n/);
	t.regex(output!, /line 6\n/);
	t.regex(output!, /line 14\n/);

  // First few lines truncated
	t.notRegex(output!, /line 0/);
	t.notRegex(output!, /line 2/);
})

test('StreamingReasoning renders without crashing with empty message', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingReasoning reasoning="" compact={false} startTime={Date.now()} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Thinking/);
});

test.afterEach(() => {
	cleanup();
});
