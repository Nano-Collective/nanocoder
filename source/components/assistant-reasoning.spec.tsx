import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import AssistantReasoning from './assistant-reasoning';

console.log(`\nassistant-reasoning.spec.tsx – ${React.version}`);

/*
Tests assistant reasoning specifically.

Markdown parsing and html decoding functions
tested in `assistant-message.spec.tsx`.
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

test('AssistantReasoning expanded renders with message', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning reasoning="Hello world" expand={true} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Thinking/);
	t.regex(output!, /Hello world/);
});

test('AssistantReasoning compacted renders without message', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning reasoning="Hello world" expand={false} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Thinking/);

	// No token count or message
	t.notRegex(output!, /Hello world/);
	t.notRegex(output!, /~\d+ tokens/);
});

test('AssistantReasoning renders with bold text', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning reasoning="This is **bold** text" expand={true} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /bold/);
});

test('AssistantReasoning renders with inline code', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning
				reasoning="Use `const` for constants"
				expand={true}
			/>
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /const/);
	t.regex(output!, /for constants/);
});

test('AssistantReasoning renders with HTML entities', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning
				reasoning="Price: &euro;100&nbsp;only"
				expand={true}
			/>
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should have decoded entities
	t.regex(output!, /Price:/);
	t.regex(output!, /100/);
	t.regex(output!, /only/);
});

test('AssistantReasoning renders with markdown table', t => {
	const message = `| Name | Age |
|------|-----|
| John | 30  |
| Jane | 25  |`;

	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning reasoning={message} expand={true} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Name/);
	t.regex(output!, /Age/);
	t.regex(output!, /John/);
	t.regex(output!, /Jane/);
	// Should contain table separators
	t.regex(output!, /│/);
});

test('AssistantReasoning renders with headings', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning reasoning="# Main Heading" expand={true} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Main Heading/);
});

test('AssistantReasoning renders with lists', t => {
	const message = `- Item 1
- Item 2
- Item 3`;

	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning reasoning={message} expand={true} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Item 1/);
	t.regex(output!, /Item 2/);
	t.regex(output!, /Item 3/);
	// Should contain bullets
	t.regex(output!, /•/);
});

test('AssistantReasoning renders with blockquotes', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning reasoning="> This is a quote" expand={true} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /This is a quote/);
});

test('AssistantReasoning renders with links', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning
				reasoning="Check [this link](https://example.com)"
				expand={true}
			/>
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /this link/);
	t.regex(output!, /https:\/\/example\.com/);
});

test('AssistantReasoning renders with mixed markdown', t => {
	const message = `# Title

This has **bold** and *italic* text.

- List item

Price: &euro;50`;

	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning reasoning={message} expand={true} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Title/);
	t.regex(output!, /bold/);
	t.regex(output!, /italic/);
	t.regex(output!, /List item/);
	t.regex(output!, /50/);
});

test('AssistantReasoning displays approximate token count', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning reasoning="Hello world" expand={true} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /~\d+ tokens/);
});

test('AssistantReasoning renders without crashing with empty message', t => {
	const {lastFrame} = render(
		<MockThemeProvider>
			<AssistantReasoning reasoning="" expand={true} />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Thinking/);
});
