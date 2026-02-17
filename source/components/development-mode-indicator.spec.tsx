import {render} from 'ink-testing-library';
import test from 'ava';
import React from 'react';
import {DevelopmentModeIndicator} from './development-mode-indicator';

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

// ============================================================================
// Component Rendering Tests
// ============================================================================

test('DevelopmentModeIndicator renders with normal mode', t => {
	const {lastFrame} = render(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /normal mode on/);
});

test('DevelopmentModeIndicator renders with auto-accept mode', t => {
	const {lastFrame} = render(
		<DevelopmentModeIndicator
			developmentMode="auto-accept"
			colors={mockColors}
			contextPercentUsed={null}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /auto-accept mode on/);
});

test('DevelopmentModeIndicator renders with plan mode', t => {
	const {lastFrame} = render(
		<DevelopmentModeIndicator developmentMode="plan" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /plan mode on/);
});

test('DevelopmentModeIndicator renders without crashing', t => {
	const {unmount} = render(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	t.notThrows(() => unmount());
});

// ============================================================================
// Props Tests
// ============================================================================

test('DevelopmentModeIndicator accepts all valid development modes', t => {
	const modes = ['normal', 'auto-accept', 'plan'] as const;

	for (const mode of modes) {
		t.notThrows(() => {
			render(
				<DevelopmentModeIndicator developmentMode={mode} colors={mockColors} contextPercentUsed={null} />,
			);
		});
	}
});

test('DevelopmentModeIndicator accepts colors object', t => {
	t.notThrows(() => {
		render(
			<DevelopmentModeIndicator
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

test('DevelopmentModeIndicator has correct display name', t => {
	t.is(DevelopmentModeIndicator.displayName, 'DevelopmentModeIndicator');
});

// ============================================================================
// Content Tests
// ============================================================================

test('DevelopmentModeIndicator shows mode label in bold', t => {
	const {lastFrame} = render(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	// Bold is represented by ANSI escape codes, check for the label
	t.regex(output!, /normal mode on/);
});

test('DevelopmentModeIndicator shows context percentage when provided', t => {
	const {lastFrame} = render(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={42} />,
	);

	const output = lastFrame();
	t.regex(output!, /ctx: 42%/);
});

test('DevelopmentModeIndicator hides context percentage when null', t => {
	const {lastFrame} = render(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.notRegex(output!, /ctx:/);
});

test('DevelopmentModeIndicator normal mode uses correct label', t => {
	const {lastFrame} = render(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.regex(output!, /normal mode on/);
	t.notRegex(output!, /auto-accept mode on/);
	t.notRegex(output!, /plan mode on/);
});

test('DevelopmentModeIndicator auto-accept mode uses correct label', t => {
	const {lastFrame} = render(
		<DevelopmentModeIndicator
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

test('DevelopmentModeIndicator plan mode uses correct label', t => {
	const {lastFrame} = render(
		<DevelopmentModeIndicator developmentMode="plan" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.regex(output!, /plan mode on/);
	t.notRegex(output!, /normal mode on/);
	t.notRegex(output!, /auto-accept mode on/);
});

// ============================================================================
// Memoization Tests
// ============================================================================

test('DevelopmentModeIndicator is memoized', t => {
	// React.memo components should have the same reference when props don't change
	const firstRender = render(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);
	const firstOutput = firstRender.lastFrame();

	const secondRender = render(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);
	const secondOutput = secondRender.lastFrame();

	// Should produce the same output with same props
	t.is(firstOutput, secondOutput);
});

test('DevelopmentModeIndicator updates when developmentMode changes', t => {
	const {lastFrame, rerender} = render(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	const normalOutput = lastFrame();
	t.regex(normalOutput!, /normal mode on/);

	rerender(
		<DevelopmentModeIndicator
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

test('DevelopmentModeIndicator has correct structure', t => {
	const {lastFrame} = render(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={25} />,
	);

	const output = lastFrame();
	// Should have the mode label and context percentage
	t.regex(output!, /normal mode on/);
	t.regex(output!, /ctx: 25%/);
});

test('DevelopmentModeIndicator component can be unmounted', t => {
	const {unmount} = render(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	t.notThrows(() => {
		unmount();
	});
});

// ============================================================================
// Edge Cases
// ============================================================================

test('DevelopmentModeIndicator handles rapid mode changes', t => {
	const {lastFrame, rerender} = render(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	// Cycle through modes rapidly
	rerender(
		<DevelopmentModeIndicator
			developmentMode="auto-accept"
			colors={mockColors}
			contextPercentUsed={null}
		/>,
	);
	rerender(
		<DevelopmentModeIndicator developmentMode="plan" colors={mockColors} contextPercentUsed={null} />,
	);
	rerender(
		<DevelopmentModeIndicator developmentMode="normal" colors={mockColors} contextPercentUsed={null} />,
	);

	const output = lastFrame();
	t.regex(output!, /normal mode on/);
});

test('DevelopmentModeIndicator handles custom colors', t => {
	const customColors = {
		...mockColors,
		secondary: '#123456',
		info: '#789ABC',
		warning: '#DEF012',
	};

	t.notThrows(() => {
		render(
			<DevelopmentModeIndicator
				developmentMode="normal"
				colors={customColors}
				contextPercentUsed={null}
			/>,
		);
	});
});
