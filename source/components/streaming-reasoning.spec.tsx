import test from 'ava';
import { cleanup, render } from 'ink-testing-library';
import React from 'react';
import stripAnsi from 'strip-ansi';
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
			<StreamingReasoning reasoning="Hello world" expand={true} />
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
			<StreamingReasoning reasoning="Hello world" expand={false} />
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
			<StreamingReasoning reasoning={message} expand={true} />
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
			<StreamingReasoning reasoning={message} expand={true} />
		</MockThemeProvider>,
	);

	// Strip ANSI: CI sets FORCE_COLOR=1 so ink wraps styled glyphs (like the
	// truncation `…`) in escape sequences. Without stripping, the regex fails
	// in CI even though it passes locally where FORCE_COLOR is unset.
	const output = stripAnsi(lastFrame() ?? '');
	t.truthy(output);
  // Truncated symbol, on its own line. Box renderer may pad with trailing
  // spaces to fill terminal width, so allow any whitespace before the newline.
	t.regex(output, /Thinking/);
	t.regex(output, /…[ ]*\n/);
	t.regex(output, /line 3[ ]*\n/);
	t.regex(output, /line 6[ ]*\n/);
	t.regex(output, /line 14[ ]*\n/);

  // First few lines truncated
	t.notRegex(output, /line 0/);
	t.notRegex(output, /line 2/);
})

test('StreamingReasoning renders without crashing with empty message', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingReasoning reasoning="" expand={true} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Thinking/);
});

const buildLines = (count: number) =>
	Array.from(
		{length: count},
		(_, i) => `line-${String(i).padStart(6, '0')} ${'token '.repeat(8)}`,
	).join('\n');

test('StreamingReasoning strips leading newlines', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingReasoning reasoning={'\n\n\nHello world'} expand={true} />
		</MockThemeProvider>,
	);

	const lines = stripAnsi(lastFrame() ?? '')
		.split('\n')
		.map(line => line.trimEnd());
	t.regex(lines[0], /Thinking/);
	t.is(lines[1], 'Hello world', 'blank lines must not pad the trace');
});

test('StreamingReasoning shows only the tail of a huge stream across flushes', t => {
	// The reasoning string grows for the whole stream, so each flush must stay
	// bounded to a tail instead of re-wrapping everything accumulated so far.
	const reasoning = buildLines(5000);
	t.true(reasoning.length > 100_000);

	const {lastFrame, rerender} = render(
		<MockThemeProvider>
			<StreamingReasoning reasoning={reasoning} expand={true} />
		</MockThemeProvider>,
	);

	let current = reasoning;
	for (let i = 0; i < 20; i++) {
		current += `\nappended-${i} ${'token '.repeat(20)}`;
		rerender(
			<MockThemeProvider>
				<StreamingReasoning reasoning={current} expand={true} />
			</MockThemeProvider>,
		);
	}

	const output = stripAnsi(lastFrame() ?? '');
	t.true(output.includes('appended-19'));
	t.false(output.includes('line-000000'));
	t.true(output.includes('…'));
});

test('StreamingReasoning collapsed renders the header only for a huge stream', t => {
	// Collapsed is the default, so this path runs for most of a stream and must
	// render nothing from the trace itself.
	const {lastFrame} = render(
		<MockThemeProvider>
			<StreamingReasoning reasoning={buildLines(5000)} expand={false} />
		</MockThemeProvider>,
	);

	const output = stripAnsi(lastFrame() ?? '');
	t.regex(output, /Thinking/);
	t.false(output.includes('line-004999'));
	t.notRegex(output, /~[\nd,]+ tokens/);
});

test.afterEach(() => {
	cleanup();
});
