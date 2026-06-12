import {useResponsiveTerminal, useTerminalWidth} from './useTerminalWidth.js';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';

console.log('\nuseTerminalWidth.spec.tsx');

// Helper component to test useTerminalWidth
function TerminalWidthConsumer({
	onRender,
}: {
	onRender: (width: number) => void;
}) {
	const width = useTerminalWidth();
	React.useEffect(() => {
		onRender(width);
	}, [width, onRender]);
	return null;
}

// Helper component to test useResponsiveTerminal
function ResponsiveTerminalConsumer({
	onRender,
}: {
	onRender: (terminal: ReturnType<typeof useResponsiveTerminal>) => void;
}) {
	const terminal = useResponsiveTerminal();
	React.useEffect(() => {
		onRender(terminal);
	}, [terminal, onRender]);
	return null;
}

test('useTerminalWidth returns calculated box width', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 100;

	let capturedWidth: number | null = null;

	render(
		React.createElement(TerminalWidthConsumer, {
			onRender: width => {
				capturedWidth = width;
			},
		}),
	);

	t.truthy(capturedWidth);
	// Box width should be columns - 4, max 120, min 40
	// 100 - 4 = 96
	t.is(capturedWidth!, 96);

	process.stdout.columns = originalColumns;
});

test('useTerminalWidth respects minimum width of 40', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 30; // Very narrow terminal

	let capturedWidth: number | null = null;

	render(
		React.createElement(TerminalWidthConsumer, {
			onRender: width => {
				capturedWidth = width;
			},
		}),
	);

	t.truthy(capturedWidth);
	t.is(capturedWidth!, 40); // Should be clamped to minimum

	process.stdout.columns = originalColumns;
});

test('useTerminalWidth respects maximum width of 120', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 200; // Very wide terminal

	let capturedWidth: number | null = null;

	render(
		React.createElement(TerminalWidthConsumer, {
			onRender: width => {
				capturedWidth = width;
			},
		}),
	);

	t.truthy(capturedWidth);
	t.is(capturedWidth!, 120); // Should be clamped to maximum

	process.stdout.columns = originalColumns;
});

test('useResponsiveTerminal detects narrow size', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50; // Narrow terminal

	let capturedTerminal: ReturnType<typeof useResponsiveTerminal> | null = null;

	render(
		React.createElement(ResponsiveTerminalConsumer, {
			onRender: terminal => {
				capturedTerminal = terminal;
			},
		}),
	);

	t.truthy(capturedTerminal);
	t.is(capturedTerminal!.size, 'narrow');
	t.true(capturedTerminal!.isNarrow);
	t.false(capturedTerminal!.isNormal);
	t.false(capturedTerminal!.isWide);

	process.stdout.columns = originalColumns;
});

test('useResponsiveTerminal detects normal size', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 100; // Normal terminal

	let capturedTerminal: ReturnType<typeof useResponsiveTerminal> | null = null;

	render(
		React.createElement(ResponsiveTerminalConsumer, {
			onRender: terminal => {
				capturedTerminal = terminal;
			},
		}),
	);

	t.truthy(capturedTerminal);
	t.is(capturedTerminal!.size, 'normal');
	t.false(capturedTerminal!.isNarrow);
	t.true(capturedTerminal!.isNormal);
	t.false(capturedTerminal!.isWide);

	process.stdout.columns = originalColumns;
});

test('useResponsiveTerminal detects wide size', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 140; // Wide terminal

	let capturedTerminal: ReturnType<typeof useResponsiveTerminal> | null = null;

	render(
		React.createElement(ResponsiveTerminalConsumer, {
			onRender: terminal => {
				capturedTerminal = terminal;
			},
		}),
	);

	t.truthy(capturedTerminal);
	t.is(capturedTerminal!.size, 'wide');
	t.false(capturedTerminal!.isNarrow);
	t.false(capturedTerminal!.isNormal);
	t.true(capturedTerminal!.isWide);

	process.stdout.columns = originalColumns;
});

test('useResponsiveTerminal truncate utility works correctly', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	let capturedTerminal: ReturnType<typeof useResponsiveTerminal> | null = null;

	render(
		React.createElement(ResponsiveTerminalConsumer, {
			onRender: terminal => {
				capturedTerminal = terminal;
			},
		}),
	);

	t.truthy(capturedTerminal);

	// Test short text (no truncation)
	const shortText = 'hello';
	t.is(capturedTerminal!.truncate(shortText, 10), shortText);

	// Test long text (truncation with ellipsis)
	const longText = 'this is a very long text that should be truncated';
	const truncated = capturedTerminal!.truncate(longText, 20);
	t.is(truncated.length, 20);
	t.true(truncated.endsWith('...'));
	t.is(truncated, 'this is a very lo...');

	// Test exact length (no truncation)
	const exactText = 'exact';
	t.is(capturedTerminal!.truncate(exactText, 5), exactText);

	process.stdout.columns = originalColumns;
});

test('useResponsiveTerminal truncatePath utility works correctly', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	let capturedTerminal: ReturnType<typeof useResponsiveTerminal> | null = null;

	render(
		React.createElement(ResponsiveTerminalConsumer, {
			onRender: terminal => {
				capturedTerminal = terminal;
			},
		}),
	);

	t.truthy(capturedTerminal);

	// Test short path (no truncation)
	const shortPath = '/home/user';
	t.is(capturedTerminal!.truncatePath(shortPath, 20), shortPath);

	// Test long path (truncation from beginning with ellipsis)
	const longPath = '/home/user/documents/projects/myproject/src/components/Button.tsx';
	const truncated = capturedTerminal!.truncatePath(longPath, 30);
	t.is(truncated.length, 30);
	t.true(truncated.startsWith('...'));
	// Should keep the end of the path
	t.true(truncated.endsWith('Button.tsx'));

	// Test exact length (no truncation)
	const exactPath = '/home';
	t.is(capturedTerminal!.truncatePath(exactPath, 5), exactPath);

	process.stdout.columns = originalColumns;
});

test('useResponsiveTerminal provides boxWidth and actualWidth', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 100;

	let capturedTerminal: ReturnType<typeof useResponsiveTerminal> | null = null;

	render(
		React.createElement(ResponsiveTerminalConsumer, {
			onRender: terminal => {
				capturedTerminal = terminal;
			},
		}),
	);

	t.truthy(capturedTerminal);
	t.is(capturedTerminal!.actualWidth, 100);
	t.is(capturedTerminal!.boxWidth, 96); // 100 - 4

	process.stdout.columns = originalColumns;
});

test('useTerminalWidth shares one resize listener across many consumers', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 100;

	const before = process.stdout.listenerCount('resize');

	// Mount several consumers at once (the resume-replay scenario).
	const a = render(
		React.createElement(TerminalWidthConsumer, {onRender: () => {}}),
	);
	const b = render(
		React.createElement(TerminalWidthConsumer, {onRender: () => {}}),
	);
	const c = render(
		React.createElement(TerminalWidthConsumer, {onRender: () => {}}),
	);

	// At most one shared stdout listener is added regardless of consumer count
	// (it may already be attached from a prior consumer in this process).
	const afterMount = process.stdout.listenerCount('resize');
	t.true(afterMount - before <= 1);

	a.unmount();
	b.unmount();
	c.unmount();

	// Unmounting this test's consumers must not grow the listener count.
	const afterUnmount = process.stdout.listenerCount('resize');
	t.is(afterUnmount, before);

	process.stdout.columns = originalColumns;
});
