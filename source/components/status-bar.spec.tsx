import {Box} from 'ink';
import {render} from 'ink-testing-library';
import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {StatusBar} from './status-bar';

void React; // JSX runtime requires React in scope

// Mock colors object matching the theme structure
const mockColors = {
	primary: '#FFFFFF',
	secondary: '#808080',
	info: '#00FFFF',
	warning: '#FFA500',
	error: '#FF0000',
	success: '#00FF00',
	tool: '#FF00FF',
	text: '#FFFFFF',
	base: '#000000',
};

const TUNE_DEFAULTS_LIKE = {enabled: true, aggressiveCompact: false} as const;

// ============================================================================
// Tune profile label
// ============================================================================

test('tune label shows nothing when tune is disabled', t => {
	const {lastFrame} = render(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			tune={{...TUNE_DEFAULTS_LIKE, enabled: false, toolProfile: 'auto'}}
			currentModel="llama3.2:1b"
		/>,
	);
	t.notRegex(lastFrame()!, /tune:/);
});

test('tune label shows the explicit profile name', t => {
	const {lastFrame} = render(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			tune={{...TUNE_DEFAULTS_LIKE, toolProfile: 'nano'}}
			currentModel="gpt-4o"
		/>,
	);
	const output = lastFrame()!;
	t.regex(output, /tune: nano/);
	t.notRegex(output, /auto/);
});

test('tune label shows resolved profile and (auto) origin for auto on a small model', t => {
	const {lastFrame} = render(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			tune={{...TUNE_DEFAULTS_LIKE, toolProfile: 'auto'}}
			currentModel="llama3.2:1b"
		/>,
	);
	t.regex(lastFrame()!, /tune: nano \(auto\)/);
});

test('tune label resolves auto to full for cloud/unknown models', t => {
	const {lastFrame} = render(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			tune={{...TUNE_DEFAULTS_LIKE, toolProfile: 'auto'}}
			currentModel="claude-opus-4-8"
		/>,
	);
	t.regex(lastFrame()!, /tune: full \(auto\)/);
});

// ============================================================================
// Component Rendering Tests
// ============================================================================

test('StatusBar renders with normal mode', t => {
	const {lastFrame} = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /normal mode on/);
});

test('StatusBar renders with auto-accept mode', t => {
	const {lastFrame} = render(
		<StatusBar
			developmentMode="auto-accept"
			colors={mockColors}
			contextPercentUsed={null}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /auto-accept mode on/);
});

test('StatusBar renders with plan mode', t => {
	const {lastFrame} = render(
		<StatusBar developmentMode="plan" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /plan mode on/);
});

test('StatusBar renders with yolo mode', t => {
	const {lastFrame} = render(
		<StatusBar developmentMode="yolo" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /yolo mode on/);
});

test('StatusBar renders with headless mode', t => {
	const {lastFrame} = render(
		<StatusBar developmentMode="headless" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /headless mode on/);
});

test('StatusBar renders without crashing', t => {
	const {unmount} = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	t.notThrows(() => unmount());
});

// ============================================================================
// Props Tests
// ============================================================================

test('StatusBar accepts all valid development modes', t => {
	const modes = ['normal', 'auto-accept', 'yolo', 'plan', 'scheduler'] as const;

	for (const mode of modes) {
		t.notThrows(() => {
			render(
				<StatusBar developmentMode={mode} colors={mockColors} contextPercentUsed={null} />,
			);
		});
	}
});

test('StatusBar accepts colors object', t => {
	t.notThrows(() => {
		render(
			<StatusBar
				developmentMode="normal"
				colors={mockColors}
				contextPercentUsed={null}
			/>,
		);
	});
});

// ============================================================================
// Display Name Tests
// ============================================================================

test('StatusBar has correct display name', t => {
	t.is(StatusBar.displayName, 'StatusBar');
});

// ============================================================================
// Content Tests
// ============================================================================

test('StatusBar shows mode label in bold', t => {
	const {lastFrame} = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	// Bold is represented by ANSI escape codes, check for the label
	t.regex(output!, /normal mode on/);
});

test('StatusBar shows context percentage when provided', t => {
	const {lastFrame} = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={42} />,
	);

	const output = lastFrame();
	// Marker is optional here (no source given → estimated); see dedicated
	// API-vs-estimate marker tests below.
	t.regex(output!, /ctx: ~?42%/);
});

test('StatusBar hides context percentage when null', t => {
	const {lastFrame} = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.notRegex(output!, /ctx:/);
});

test('StatusBar shows API-reported context without the ~ marker', t => {
	const {lastFrame} = render(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={42}
			contextSource="api"
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /ctx: 42%/);
	t.notRegex(output!, /ctx: ~42%/);
});

test('StatusBar marks estimated context with a leading ~', t => {
	const {lastFrame} = render(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={42}
			contextSource="estimate"
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /ctx: ~42%/);
});

test('StatusBar defaults to the estimate marker when source is omitted', t => {
	const {lastFrame} = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={42} />,
	);

	const output = lastFrame();
	t.regex(output!, /ctx: ~42%/);
});

test('StatusBar normal mode uses correct label', t => {
	const {lastFrame} = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.regex(output!, /normal mode on/);
	t.notRegex(output!, /auto-accept mode on/);
	t.notRegex(output!, /plan mode on/);
});

test('StatusBar auto-accept mode uses correct label', t => {
	const {lastFrame} = render(
		<StatusBar
			developmentMode="auto-accept"
			colors={mockColors}
			contextPercentUsed={null}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /auto-accept mode on/);
	t.notRegex(output!, /normal mode on/);
	t.notRegex(output!, /plan mode on/);
});

test('StatusBar plan mode uses correct label', t => {
	const {lastFrame} = render(
		<StatusBar developmentMode="plan" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.regex(output!, /plan mode on/);
	t.notRegex(output!, /normal mode on/);
	t.notRegex(output!, /auto-accept mode on/);
});

test('StatusBar headless mode uses correct label', t => {
	const {lastFrame} = render(
		<StatusBar developmentMode="headless" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.regex(output!, /headless mode on/);
	t.notRegex(output!, /normal mode on/);
	t.notRegex(output!, /auto-accept mode on/);
	t.notRegex(output!, /plan mode on/);
});

// ============================================================================
// Memoization Tests
// ============================================================================

test('StatusBar is memoized', t => {
	// React.memo components should have the same reference when props don't change
	const firstRender = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);
	const firstOutput = firstRender.lastFrame();

	const secondRender = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);
	const secondOutput = secondRender.lastFrame();

	// Should produce the same output with same props
	t.is(firstOutput, secondOutput);
});

test('StatusBar updates when developmentMode changes', t => {
	const {lastFrame, rerender} = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	const normalOutput = lastFrame();
	t.regex(normalOutput!, /normal mode on/);

	rerender(
		<StatusBar
			developmentMode="auto-accept"
			colors={mockColors}
			contextPercentUsed={null}
		/>,
	);

	const autoAcceptOutput = lastFrame();
	t.regex(autoAcceptOutput!, /auto-accept mode on/);
});

// ============================================================================
// Structure Tests
// ============================================================================

test('StatusBar has correct structure', t => {
	const {lastFrame} = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={25} />,
	);

	const output = lastFrame();
	// Should have the mode label and context percentage
	t.regex(output!, /normal mode on/);
	t.regex(output!, /ctx: ~?25%/);
});

test('StatusBar component can be unmounted', t => {
	const {unmount} = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	t.notThrows(() => {
		unmount();
	});
});

// ============================================================================
// Edge Cases
// ============================================================================

test('StatusBar handles rapid mode changes', t => {
	const {lastFrame, rerender} = render(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	// Cycle through modes rapidly
	rerender(
		<StatusBar
			developmentMode="auto-accept"
			colors={mockColors}
			contextPercentUsed={null}
		/>,
	);
	rerender(
		<StatusBar developmentMode="plan" colors={mockColors} contextPercentUsed={null} />,
	);
	rerender(
		<StatusBar developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.regex(output!, /normal mode on/);
});

test('StatusBar handles custom colors', t => {
	const customColors = {
		...mockColors,
		secondary: '#123456',
		info: '#789ABC',
		warning: '#DEF012',
	};

	t.notThrows(() => {
		render(
			<StatusBar
				developmentMode="normal"
				colors={customColors}
				contextPercentUsed={null}
			/>,
		);
	});
});

// ============================================================================
// Task indicator badge
// ============================================================================

const WIDE = 200;

function renderWithWidth(
	element: React.ReactElement,
	columns: number = WIDE,
): string {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = columns;
	try {
		const {lastFrame} = render(element);
		return lastFrame()!;
	} finally {
		process.stdout.columns = originalColumns;
	}
}

test('StatusBar fits 80 columns inside an indented wrapper', t => {
	// user-input renders this row inside <Box marginLeft={3}>. Budgeting
	// against the full terminal width overflowed by exactly those columns, and
	// the terminal then cut the row mid-word rather than dropping a segment.
	const output = renderWithWidth(
		<Box marginLeft={3}>
			<StatusBar
				developmentMode="auto-accept"
				colors={mockColors}
				contextPercentUsed={42}
				sessionName={'s'.repeat(45)}
				indentColumns={3}
			/>
		</Box>,
		80,
	);

	for (const line of stripAnsi(output).split('\n')) {
		t.true(
			line.length <= 80,
			`row is ${line.length} columns wide in an 80-column terminal`,
		);
	}
});

test('StatusBar shows Tasks (~2/5 Ctrl+T) when collapsed with in-progress tasks', t => {
	const output = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			taskInfo={{
				totalCount: 5,
				completedCount: 2,
				inProgressCount: 1,
				isHidden: true,
				hasUnread: false,
			}}
		/>,
	);
	t.regex(output, /Tasks \(~2\/5 Ctrl\+T\)/);
});

test('StatusBar shows Tasks (2/5 Ctrl+T) when collapsed with no in-progress tasks', t => {
	const output = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			taskInfo={{
				totalCount: 5,
				completedCount: 2,
				inProgressCount: 0,
				isHidden: true,
				hasUnread: false,
			}}
		/>,
	);
	t.regex(output, /Tasks \(2\/5 Ctrl\+T\)/);
});

test('StatusBar shows Tasks (~2/5* Ctrl+T) when collapsed with in-progress and unread updates', t => {
	const output = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			taskInfo={{
				totalCount: 5,
				completedCount: 2,
				inProgressCount: 1,
				isHidden: true,
				hasUnread: true,
			}}
		/>,
	);
	t.regex(output, /Tasks \(~2\/5\* Ctrl\+T\)/);
});

test('StatusBar shows Tasks (hide Ctrl+T) when expanded on a wide terminal', t => {
	const output = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			taskInfo={{
				totalCount: 5,
				completedCount: 2,
				inProgressCount: 1,
				isHidden: false,
				hasUnread: false,
			}}
		/>,
	);
	t.regex(output, /Tasks \(hide Ctrl\+T\)/);
});

test('StatusBar does not show task badge when totalCount is 0 or taskInfo is null', t => {
	const zero = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			taskInfo={{
				totalCount: 0,
				completedCount: 0,
				inProgressCount: 0,
				isHidden: true,
				hasUnread: false,
			}}
		/>,
	);
	t.notRegex(zero, /Tasks/);

	const missing = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			taskInfo={null}
		/>,
	);
	t.notRegex(missing, /Tasks/);
});

// ============================================================================
// Task badge width budget
// ============================================================================

test('expanded task badge is dropped entirely when the row is under width pressure', t => {
	const output = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={42}
			contextSource="api"
			taskInfo={{
				totalCount: 5,
				completedCount: 2,
				inProgressCount: 1,
				isHidden: false,
				hasUnread: false,
			}}
		/>,
		40,
	);
	// The expanded badge is pure help text - it goes before anything else does,
	// and never squeezes the segments that carry information.
	t.notRegex(output, /Tasks/);
	t.regex(output, /ctx: 42%/);
});

test('collapsed task badge keeps its progress readout and drops only the key hint under width pressure', t => {
	const output = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={42}
			contextSource="api"
			taskInfo={{
				totalCount: 5,
				completedCount: 2,
				inProgressCount: 1,
				isHidden: true,
				hasUnread: true,
			}}
		/>,
		40,
	);
	// Progress survives - it is the only trace of the collapsed list on screen.
	t.regex(output, /Tasks \(~2\/5\*\)/);
	t.notRegex(output, /Ctrl\+T/);
	t.regex(output, /ctx: 42%/);
});

test('collapsed task badge keeps the key hint when there is room for it', t => {
	const output = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			taskInfo={{
				totalCount: 5,
				completedCount: 2,
				inProgressCount: 0,
				isHidden: true,
				hasUnread: false,
			}}
		/>,
		60,
	);
	t.regex(output, /Tasks \(2\/5 Ctrl\+T\)/);
});

// ============================================================================
// Auto-save indicator tests (Issue #932)
// ============================================================================

test('StatusBar renders saving indicator when isSaving is true', t => {
	const output = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			isSaving={true}
		/>,
	);
	t.regex(output, /saving/);
});

test('StatusBar omits saving indicator when isSaving is false or undefined', t => {
	const falseOutput = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			isSaving={false}
		/>,
	);
	t.notRegex(falseOutput, /saving/);

	const undefOutput = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
		/>,
	);
	t.notRegex(undefOutput, /saving/);
});

test('saving indicator drops under narrow width pressure without shrinking session name', t => {
	const fullSession = 'feature-authentication-token';
	// Render at a tight width of 40 columns
	const output = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={40}
			contextSource="api"
			sessionName={fullSession}
			isSaving={true}
		/>,
		42,
	);

	// saving indicator must drop when width is tight
	t.notRegex(output, /saving/);
	// Session name must still have room and not be shrunk away
	t.regex(output, /feature/);
});

test('saving indicator renders when there is sufficient width', t => {
	const output = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={40}
			contextSource="api"
			sessionName="my-session"
			isSaving={true}
		/>,
		100,
	);

	t.regex(output, /my-session/);
	t.regex(output, /saving/);
	t.regex(output, /ctx: 40%/);
});

test('shift hint drops before the session name is truncated', t => {
	// 60 columns is too tight for the hint and the full session name together.
	const output = renderWithWidth(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={null}
			sessionName="Auth refactor"
			tune={{...TUNE_DEFAULTS_LIKE, toolProfile: 'full'}}
			indentColumns={4}
		/>,
		60,
	);

	t.regex(output, /Auth refactor/);
	t.notRegex(output, /Shift\+Tab/);
});

test('shift hint is shown by default on terminals with room to spare', t => {
	// The hint used to render only below 80 columns, so it was missing exactly
	// where there was room for it.
	for (const columns of [70, 100, WIDE]) {
		const output = renderWithWidth(
			<StatusBar
				developmentMode="normal"
				colors={mockColors}
				contextPercentUsed={null}
			/>,
			columns,
		);

		t.regex(output, /Shift\+Tab to cycle/, `missing at ${columns} columns`);
	}
});

test('shift hint is not offered in headless mode', t => {
	const output = renderWithWidth(
		<StatusBar
			developmentMode="headless"
			colors={mockColors}
			contextPercentUsed={null}
		/>,
	);

	t.regex(output, /headless mode on/);
	t.notRegex(output, /Shift\+Tab/);
});

// ============================================================================
// Voice segment
// ============================================================================

test('voice segment is absent when voice mode is off', t => {
	const {lastFrame} = render(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={1}
			voice={null}
		/>,
	);
	t.notRegex(stripAnsi(lastFrame()!), /voice|listening|Ctrl\+G/);
});

test('voice segment shows the idle label and its hint on the mode line', t => {
	const {lastFrame} = render(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={1}
			voice={{state: 'idle', idleHint: 'Ctrl+G to talk'}}
		/>,
	);
	const output = stripAnsi(lastFrame()!);
	t.regex(output, /ctx: ~1% · voice \(Ctrl\+G to talk\)/);
	t.is(output.split('\n').length, 1, 'stays on the one mode line');
});

test('voice segment shows each active state without the idle hint', t => {
	const cases = [
		['listening', /· ● listening/],
		['processing', /· transcribing…/],
		['speaking', /· speaking/],
	] as const;
	for (const [state, expected] of cases) {
		const {lastFrame} = render(
			<StatusBar
				developmentMode="normal"
				colors={mockColors}
				contextPercentUsed={1}
				voice={{state, idleHint: 'Ctrl+G to talk'}}
			/>,
		);
		const output = stripAnsi(lastFrame()!);
		t.regex(output, expected, state);
		t.notRegex(output, /Ctrl\+G/, state);
	}
});

test('a tight row drops the voice hint first and keeps the voice label', t => {
	// The width budget is the terminal width (80 when stdout is not a TTY)
	// minus the indent: 68 columns fits the shift hint and the voice label
	// (57) but not the voice hint on top (74).
	const {lastFrame} = render(
		<StatusBar
			developmentMode="normal"
			colors={mockColors}
			contextPercentUsed={1}
			indentColumns={12}
			voice={{state: 'idle', idleHint: 'Ctrl+G to talk'}}
		/>,
	);
	const output = stripAnsi(lastFrame()!);
	t.regex(output, /· voice/);
	t.notRegex(output, /Ctrl\+G to talk/);
	t.regex(output, /Shift\+Tab to cycle/, 'the voice hint gives way before the shift hint');
});
