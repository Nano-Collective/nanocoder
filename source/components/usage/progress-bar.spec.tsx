import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {ProgressBar} from './progress-bar.js';

console.log(`\nprogress-bar.spec.tsx – ${React.version}`);

// ============================================================================
// Component Rendering Tests
// ============================================================================

test('ProgressBar renders without crashing', t => {
	const {lastFrame} = render(
		<ProgressBar percent={50} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
});

test('ProgressBar renders 0% progress', t => {
	const {lastFrame} = render(
		<ProgressBar percent={0} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should have 20 empty characters
	t.is(output!.match(/░/g)?.length, 20);
	// Should have 0 filled characters
	t.falsy(output!.includes('█'));
});

test('ProgressBar renders 100% progress', t => {
	const {lastFrame} = render(
		<ProgressBar percent={100} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should have 20 filled characters
	t.is(output!.match(/█/g)?.length, 20);
	// Should have 0 empty characters
	t.falsy(output!.includes('░'));
});

test('ProgressBar renders 50% progress', t => {
	const {lastFrame} = render(
		<ProgressBar percent={50} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should have 10 filled characters
	t.is(output!.match(/█/g)?.length, 10);
	// Should have 10 empty characters
	t.is(output!.match(/░/g)?.length, 10);
});

test('ProgressBar renders 25% progress', t => {
	const {lastFrame} = render(
		<ProgressBar percent={25} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should have 5 filled characters (25% of 20)
	t.is(output!.match(/█/g)?.length, 5);
	// Should have 15 empty characters
	t.is(output!.match(/░/g)?.length, 15);
});

test('ProgressBar renders 75% progress', t => {
	const {lastFrame} = render(
		<ProgressBar percent={75} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should have 15 filled characters (75% of 20)
	t.is(output!.match(/█/g)?.length, 15);
	// Should have 5 empty characters
	t.is(output!.match(/░/g)?.length, 5);
});

// ============================================================================
// Width Tests
// ============================================================================

test('ProgressBar handles small width', t => {
	const {lastFrame} = render(
		<ProgressBar percent={50} width={5} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Total characters should be 5
	const totalChars =
		(output!.match(/█/g)?.length || 0) + (output!.match(/░/g)?.length || 0);
	t.is(totalChars, 5);
});

test('ProgressBar handles large width', t => {
	const {lastFrame} = render(
		<ProgressBar percent={50} width={100} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Total characters should be 100
	const totalChars =
		(output!.match(/█/g)?.length || 0) + (output!.match(/░/g)?.length || 0);
	t.is(totalChars, 100);
});

test('ProgressBar handles width of 1', t => {
	const {lastFrame} = render(
		<ProgressBar percent={0} width={1} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should have exactly 1 character
	const totalChars =
		(output!.match(/█/g)?.length || 0) + (output!.match(/░/g)?.length || 0);
	t.is(totalChars, 1);
});

test('ProgressBar handles width of 10', t => {
	const {lastFrame} = render(
		<ProgressBar percent={30} width={10} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should have 3 filled (30% of 10)
	t.is(output!.match(/█/g)?.length, 3);
	// Should have 7 empty
	t.is(output!.match(/░/g)?.length, 7);
});

// ============================================================================
// Percentage Clamping Tests
// ============================================================================

test('ProgressBar clamps negative percentage to 0', t => {
	const {lastFrame} = render(
		<ProgressBar percent={-50} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should behave like 0%
	t.is(output!.match(/░/g)?.length, 20);
	t.falsy(output!.includes('█'));
});

test('ProgressBar clamps percentage over 100', t => {
	const {lastFrame} = render(
		<ProgressBar percent={150} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should behave like 100%
	t.is(output!.match(/█/g)?.length, 20);
	t.falsy(output!.includes('░'));
});

test('ProgressBar clamps percentage at 999', t => {
	const {lastFrame} = render(
		<ProgressBar percent={999} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should behave like 100%
	t.is(output!.match(/█/g)?.length, 20);
	t.falsy(output!.includes('░'));
});

// ============================================================================
// Decimal Percentage Tests
// ============================================================================

test('ProgressBar handles decimal percentage 33.33%', t => {
	const {lastFrame} = render(
		<ProgressBar percent={33.33} width={30} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should round to 10 filled characters (33.33% of 30 = 9.999, rounds to 10)
	t.is(output!.match(/█/g)?.length, 10);
	t.is(output!.match(/░/g)?.length, 20);
});

test('ProgressBar handles decimal percentage 66.66%', t => {
	const {lastFrame} = render(
		<ProgressBar percent={66.66} width={30} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should round to 20 filled characters (66.66% of 30 = 19.998, rounds to 20)
	t.is(output!.match(/█/g)?.length, 20);
	t.is(output!.match(/░/g)?.length, 10);
});

test('ProgressBar handles very small decimal percentage', t => {
	const {lastFrame} = render(
		<ProgressBar percent={0.5} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// 0.5% of 20 = 0.1, rounds to 0
	t.falsy(output!.includes('█'));
	t.is(output!.match(/░/g)?.length, 20);
});

test('ProgressBar handles percentage 99.5%', t => {
	const {lastFrame} = render(
		<ProgressBar percent={99.5} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// 99.5% of 20 = 19.9, rounds to 20
	t.is(output!.match(/█/g)?.length, 20);
	t.falsy(output!.includes('░'));
});

// ============================================================================
// Color Tests
// ============================================================================

test('ProgressBar accepts different color formats', t => {
	// Test hex color
	const {lastFrame: frame1} = render(
		<ProgressBar percent={50} width={20} color="#ff0000" />,
	);
	t.truthy(frame1());

	// Test rgb color
	const {lastFrame: frame2} = render(
		<ProgressBar percent={50} width={20} color="rgb(255, 0, 0)" />,
	);
	t.truthy(frame2());

	// Test named color
	const {lastFrame: frame3} = render(
		<ProgressBar percent={50} width={20} color="red" />,
	);
	t.truthy(frame3());
});

// ============================================================================
// Edge Cases
// ============================================================================

test('ProgressBar handles 1% progress', t => {
	const {lastFrame} = render(
		<ProgressBar percent={1} width={100} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// 1% of 100 = 1
	t.is(output!.match(/█/g)?.length, 1);
	t.is(output!.match(/░/g)?.length, 99);
});

test('ProgressBar handles 99% progress', t => {
	const {lastFrame} = render(
		<ProgressBar percent={99} width={100} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// 99% of 100 = 99
	t.is(output!.match(/█/g)?.length, 99);
	t.is(output!.match(/░/g)?.length, 1);
});

test('ProgressBar total width equals specified width', t => {
	const width = 30;
	const {lastFrame} = render(
		<ProgressBar percent={37} width={width} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Total characters should equal width
	const totalChars =
		(output!.match(/█/g)?.length || 0) + (output!.match(/░/g)?.length || 0);
	t.is(totalChars, width);
});

test('ProgressBar handles zero width with fallback to minimum', t => {
	const {lastFrame} = render(
		<ProgressBar percent={50} width={0} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Zero width should fall back to minimum width (10) to prevent crashes
	// 50% of 10 = 5 filled, 5 empty
	t.is(output!.match(/█/g)?.length, 5);
	t.is(output!.match(/░/g)?.length, 5);
});

// ============================================================================
// Rounding Tests
// ============================================================================

test('ProgressBar rounds correctly at 0.4', t => {
	const {lastFrame} = render(
		<ProgressBar percent={2} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// 2% of 20 = 0.4, rounds to 0
	t.falsy(output!.includes('█'));
	t.is(output!.match(/░/g)?.length, 20);
});

test('ProgressBar rounds correctly at 0.5', t => {
	const {lastFrame} = render(
		<ProgressBar percent={2.5} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// 2.5% of 20 = 0.5, rounds to 1
	t.is(output!.match(/█/g)?.length, 1);
	t.is(output!.match(/░/g)?.length, 19);
});

test('ProgressBar rounds correctly at 0.6', t => {
	const {lastFrame} = render(
		<ProgressBar percent={3} width={20} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// 3% of 20 = 0.6, rounds to 1
	t.is(output!.match(/█/g)?.length, 1);
	t.is(output!.match(/░/g)?.length, 19);
});

// ============================================================================
// Visual Consistency Tests
// ============================================================================

test('ProgressBar uses correct filled character', t => {
	const {lastFrame} = render(
		<ProgressBar percent={50} width={10} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should use the full block character
	t.truthy(output!.includes('█'));
});

test('ProgressBar uses correct empty character', t => {
	const {lastFrame} = render(
		<ProgressBar percent={50} width={10} color="#00ff00" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should use the light shade character
	t.truthy(output!.includes('░'));
});

test('ProgressBar maintains consistent total width across different percentages', t => {
	const width = 40;
	const percentages = [0, 10, 25, 33, 50, 67, 75, 90, 100];

	for (const percent of percentages) {
		const {lastFrame} = render(
			<ProgressBar percent={percent} width={width} color="#00ff00" />,
		);

		const output = lastFrame();
		t.truthy(output);

		const totalChars =
			(output!.match(/█/g)?.length || 0) + (output!.match(/░/g)?.length || 0);
		t.is(totalChars, width, `Total width should be ${width} for ${percent}%`);
	}
});
