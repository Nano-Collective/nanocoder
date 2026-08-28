import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import {
	ErrorMessage,
	InfoMessage,
	SuccessMessage,
	WarningMessage,
} from './message-box';

console.log(`\nmessage-box.spec.tsx – ${React.version}`);

// ============================================================================
// ErrorMessage Component Tests
// ============================================================================

test('ErrorMessage renders with message', t => {
	const {lastFrame} = renderWithTheme(
			<ErrorMessage message="Something went wrong" />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Error/);
	t.regex(output!, /Something went wrong/);
});

test('ErrorMessage renders with hideTitle', t => {
	const {lastFrame} = renderWithTheme(
			<ErrorMessage message="Error without title" hideTitle />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Error without title/);
	// Should still have border but no title
	t.regex(output!, /╭/); // Has border
});

test('ErrorMessage renders with hideBox', t => {
	const {lastFrame} = renderWithTheme(
			<ErrorMessage message="Plain error text" hideBox />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Plain error text/);
	// Should not have border characters when hideBox is true
	t.notRegex(output!, /╭/);
});

test('ErrorMessage renders without crashing', t => {
	const {unmount} = renderWithTheme(<ErrorMessage message="Test" />);

	t.notThrows(() => unmount());
});

// ============================================================================
// SuccessMessage Component Tests
// ============================================================================

test('SuccessMessage renders with message', t => {
	const {lastFrame} = renderWithTheme(
			<SuccessMessage message="Operation completed" />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Success/);
	t.regex(output!, /Operation completed/);
});

test('SuccessMessage renders with hideTitle', t => {
	const {lastFrame} = renderWithTheme(
			<SuccessMessage message="Success without title" hideTitle />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Success without title/);
	t.regex(output!, /╭/); // Has border
});

test('SuccessMessage renders with hideBox', t => {
	const {lastFrame} = renderWithTheme(
			<SuccessMessage message="Plain success text" hideBox />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Plain success text/);
	t.notRegex(output!, /╭/);
});

test('SuccessMessage renders without crashing', t => {
	const {unmount} = renderWithTheme(<SuccessMessage message="Test" />);

	t.notThrows(() => unmount());
});

// ============================================================================
// WarningMessage Component Tests
// ============================================================================

test('WarningMessage renders with message', t => {
	const {lastFrame} = renderWithTheme(
			<WarningMessage message="Proceed with caution" />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Warning/);
	t.regex(output!, /Proceed with caution/);
});

test('WarningMessage renders with hideTitle', t => {
	const {lastFrame} = renderWithTheme(
			<WarningMessage message="Warning without title" hideTitle />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Warning without title/);
	t.regex(output!, /╭/); // Has border
});

test('WarningMessage renders with hideBox', t => {
	const {lastFrame} = renderWithTheme(
			<WarningMessage message="Plain warning text" hideBox />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Plain warning text/);
	t.notRegex(output!, /╭/);
});

test('WarningMessage renders without crashing', t => {
	const {unmount} = renderWithTheme(<WarningMessage message="Test" />);

	t.notThrows(() => unmount());
});

// ============================================================================
// InfoMessage Component Tests
// ============================================================================

test('InfoMessage renders with message', t => {
	const {lastFrame} = renderWithTheme(
			<InfoMessage message="Here is some information" />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Info/);
	t.regex(output!, /Here is some information/);
});

test('InfoMessage renders with hideTitle', t => {
	const {lastFrame} = renderWithTheme(
			<InfoMessage message="Info without title" hideTitle />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Info without title/);
	t.regex(output!, /╭/); // Has border
});

test('InfoMessage renders with hideBox', t => {
	const {lastFrame} = renderWithTheme(
			<InfoMessage message="Plain info text" hideBox />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Plain info text/);
	t.notRegex(output!, /╭/);
});

test('InfoMessage renders without crashing', t => {
	const {unmount} = renderWithTheme(<InfoMessage message="Test" />);

	t.notThrows(() => unmount());
});

// ============================================================================
// Props Combination Tests
// ============================================================================

test('Message components accept all valid prop combinations', t => {
	const components = [
		{Component: ErrorMessage, name: 'ErrorMessage'},
		{Component: SuccessMessage, name: 'SuccessMessage'},
		{Component: WarningMessage, name: 'WarningMessage'},
		{Component: InfoMessage, name: 'InfoMessage'},
	];

	for (const {Component, name} of components) {
		// Default props
		t.notThrows(
			() => {
				renderWithTheme(<Component message="Test message" />);
			},
			`${name} should render with default props`,
		);

		// With hideTitle
		t.notThrows(
			() => {
				renderWithTheme(<Component message="Test message" hideTitle />);
			},
			`${name} should render with hideTitle`,
		);

		// With hideBox
		t.notThrows(
			() => {
				renderWithTheme(<Component message="Test message" hideBox />);
			},
			`${name} should render with hideBox`,
		);

		// With both hideTitle and hideBox (hideBox takes precedence)
		t.notThrows(
			() => {
				renderWithTheme(<Component message="Test message" hideTitle hideBox />);
			},
			`${name} should render with both hideTitle and hideBox`,
		);
	}
});

// ============================================================================
// Edge Cases
// ============================================================================

test('Message components handle empty message', t => {
	const {lastFrame} = renderWithTheme(
			<ErrorMessage message="" />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Error/);
});

test('Message components handle long messages', t => {
	const longMessage =
		'This is a very long message that should still render correctly even though it contains many words and might need to wrap to multiple lines in the terminal output.';

	const {lastFrame} = renderWithTheme(
			<InfoMessage message={longMessage} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /This is a very long message/);
});

test('Message components handle special characters', t => {
	const specialMessage = 'Error: File "test.txt" not found! <path/to/file>';

	const {lastFrame} = renderWithTheme(
			<ErrorMessage message={specialMessage} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Error/);
	t.regex(output!, /File/);
	t.regex(output!, /test\.txt/);
});

test('Message components handle newlines in message', t => {
	const multilineMessage = 'Line 1\nLine 2\nLine 3';

	const {lastFrame} = renderWithTheme(
			<WarningMessage message={multilineMessage} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Line 1/);
	t.regex(output!, /Line 2/);
	t.regex(output!, /Line 3/);
});

// ============================================================================
// Visual Consistency Tests
// ============================================================================

test('All message types render with TitledBox by default', t => {
	const components = [
		{Component: ErrorMessage, title: 'Error'},
		{Component: SuccessMessage, title: 'Success'},
		{Component: WarningMessage, title: 'Warning'},
		{Component: InfoMessage, title: 'Info'},
	];

	for (const {Component, title} of components) {
		const {lastFrame} = renderWithTheme(<Component message="Test" />);

		const output = lastFrame();
		t.regex(output!, new RegExp(title), `${title} message should show title`);
		t.regex(output!, /╭/, `${title} message should have top border`);
		t.regex(output!, /╰/, `${title} message should have bottom border`);
	}
});

test('hideTitle removes title but keeps border', t => {
	const {lastFrame} = renderWithTheme(
			<ErrorMessage message="No title here" hideTitle />
	);

	const output = lastFrame();
	t.truthy(output);
	// Should have border
	t.regex(output!, /╭/);
	t.regex(output!, /╰/);
	// Content should be visible
	t.regex(output!, /No title here/);
});

test('hideBox renders plain text without border', t => {
	const {lastFrame} = renderWithTheme(
			<SuccessMessage message="Plain text only" hideBox />
	);

	const output = lastFrame();
	t.truthy(output);
	// Should not have any border characters
	t.notRegex(output!, /╭/);
	t.notRegex(output!, /╮/);
	t.notRegex(output!, /╰/);
	t.notRegex(output!, /╯/);
	t.notRegex(output!, /│/);
	// Content should still be visible
	t.regex(output!, /Plain text only/);
});

// ============================================================================
// Wrapping
//
// Ink wraps with wrap-ansi at trim: false. Usually the word-boundary space
// stays on the end of the previous line and nothing looks wrong — but when
// that space falls exactly on the wrap column it becomes the first character
// of the continuation line, and the message renders one column out. Width 59
// is one such column for the message below.
// ============================================================================

const WRAPPING_MESSAGE =
	'chore(release): prepare release tooling, docs and changeset notes for v1.30.0';

/** boxWidth = max(min(columns - 4, 200), 40), so pick columns to hit a width. */
function withTerminalColumns<T>(columns: number, run: () => T): T {
	const original = process.stdout.columns;
	Object.defineProperty(process.stdout, 'columns', {
		value: columns,
		configurable: true,
	});
	try {
		return run();
	} finally {
		Object.defineProperty(process.stdout, 'columns', {
			value: original,
			configurable: true,
		});
	}
}

function renderedLines(frame: string): string[] {
	return stripAnsi(frame)
		.split('\n')
		.map(line => line.replace(/\s+$/, ''))
		.filter(line => line !== '');
}

test('hideBox does not indent a continuation line that wraps on a space', t => {
	// boxWidth 59: the space before "notes" lands on the wrap column.
	const lines = withTerminalColumns(63, () => {
		const {lastFrame} = renderWithTheme(
			<SuccessMessage message={WRAPPING_MESSAGE} hideBox />,
		);
		return renderedLines(lastFrame()!);
	});

	t.is(lines.length, 2, 'message must wrap into exactly two lines');
	t.is(lines[0], 'chore(release): prepare release tooling, docs and changeset');
	t.is(lines[1], 'notes for v1.30.0', 'continuation line starts at column 0');
});

test('bordered messages wrap flush against the box padding', t => {
	// boxWidth 55, so the inner text width is 49 — another artifact column.
	const contentLines = withTerminalColumns(59, () => {
		const {lastFrame} = renderWithTheme(
			<SuccessMessage message={WRAPPING_MESSAGE} hideTitle />,
		);
		return stripAnsi(lastFrame()!)
			.split('\n')
			.filter(line => line.startsWith('│'))
			.map(line => line.slice(1).replace(/│\s*$/, ''))
			.filter(line => line.trim() !== '');
	});

	t.true(contentLines.length > 1, 'message must be long enough to wrap');

	for (const line of contentLines) {
		// paddingX={2}, so content starts at exactly two spaces. The trim:false
		// artifact would push a continuation line out to three.
		t.regex(
			line,
			/^ {2}\S/,
			`content must start at the padding column: ${JSON.stringify(line)}`,
		);
	}
});

test('wrapping preserves indentation the caller wrote itself', t => {
	const lines = withTerminalColumns(63, () => {
		const {lastFrame} = renderWithTheme(
			<SuccessMessage message={'Summary\n    indented detail'} hideBox />,
		);
		return renderedLines(lastFrame()!);
	});

	t.deepEqual(
		lines,
		['Summary', '    indented detail'],
		'authored leading whitespace is not an artifact and must survive',
	);
});
