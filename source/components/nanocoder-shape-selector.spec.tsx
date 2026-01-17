import test from 'ava';
import React from 'react';
import NanocoderShapeSelector from './nanocoder-shape-selector';
import {renderWithTheme} from '@/test-utils/render-with-theme';

console.log('\nnanocoder-shape-selector.spec.tsx');

// ============================================================================
// Rendering Tests
// ============================================================================

test.serial(
	'nanocoder-shape-selector: renders selector with all shape options',
	t => {
		const {frames, unmount} = renderWithTheme(
			React.createElement(NanocoderShapeSelector, {
				onComplete: () => {},
				onCancel: () => {},
			}),
		);

		const latestFrame = frames.at(-1) || '';

		// Should render the title box
		t.regex(latestFrame, /Choose your Nanocoder branding style/);

		// Should render instructions
		t.regex(latestFrame, /Use arrow keys to navigate/);
		t.regex(latestFrame, /Press Enter to select/);
		t.regex(latestFrame, /Press Esc to cancel/);

		// Should render navigation instructions
		t.regex(latestFrame, /Navigate • Enter Select • Esc Cancel/);

		unmount();
	},
);

test.serial('nanocoder-shape-selector: renders all available font shapes', t => {
	const {frames, unmount} = renderWithTheme(
		React.createElement(NanocoderShapeSelector, {
			onComplete: () => {},
			onCancel: () => {},
		}),
	);

	const latestFrame = frames.at(-1) || '';

	// Should include all shape options
	const shapeNames = [
		'Tiny',
		'Block',
		'Simple',
		'Simple Block',
		'Slick',
		'Grid',
		'Pallet',
		'Shade',
		'3D',
		'Simple 3D',
		'Chrome',
		'Huge',
	];

	shapeNames.forEach(shapeName => {
		t.regex(latestFrame, new RegExp(shapeName), `Should show ${shapeName}`);
	});

	unmount();
});

test.serial('nanocoder-shape-selector: renders preview text', t => {
	const {frames, unmount} = renderWithTheme(
		React.createElement(NanocoderShapeSelector, {
			onComplete: () => {},
			onCancel: () => {},
		}),
	);

	const latestFrame = frames.at(-1) || '';

	// BigText renders some characters - just verify something is rendered
	t.true(latestFrame.length > 0);

	unmount();
});

test.serial(
	'nanocoder-shape-selector: renders prompt to select branding style',
	t => {
		const {frames, unmount} = renderWithTheme(
			React.createElement(NanocoderShapeSelector, {
				onComplete: () => {},
				onCancel: () => {},
			}),
		);

		const latestFrame = frames.at(-1) || '';

		t.regex(latestFrame, /Select a branding style/);

		unmount();
	},
);

// ============================================================================
// Responsive Tests
// ============================================================================

test.serial(
	'nanocoder-shape-selector: renders NC on narrow terminals',
	t => {
		const originalColumns = process.stdout.columns;
		process.stdout.columns = 50; // Narrow terminal

		const {frames, unmount} = renderWithTheme(
			React.createElement(NanocoderShapeSelector, {
				onComplete: () => {},
				onCancel: () => {},
			}),
		);

		const latestFrame = frames.at(-1) || '';

		// Should render something (BigText output)
		t.true(latestFrame.length > 0);

		process.stdout.columns = originalColumns;
		unmount();
	},
);

test.serial(
	'nanocoder-shape-selector: renders Nanocoder on wide terminals',
	t => {
		const originalColumns = process.stdout.columns;
		process.stdout.columns = 120; // Wide terminal

		const {frames, unmount} = renderWithTheme(
			React.createElement(NanocoderShapeSelector, {
				onComplete: () => {},
				onCancel: () => {},
			}),
		);

		const latestFrame = frames.at(-1) || '';

		// Should render something (BigText output)
		t.true(latestFrame.length > 0);

		process.stdout.columns = originalColumns;
		unmount();
	},
);

// ============================================================================
// Component Structure Tests
// ============================================================================

test.serial('nanocoder-shape-selector: renders without crashing', t => {
	const {lastFrame, unmount} = renderWithTheme(
		React.createElement(NanocoderShapeSelector, {
			onComplete: () => {},
			onCancel: () => {},
		}),
	);

	t.truthy(lastFrame());
	unmount();
});

test.serial('nanocoder-shape-selector: has shape descriptions', t => {
	const {frames, unmount} = renderWithTheme(
		React.createElement(NanocoderShapeSelector, {
			onComplete: () => {},
			onCancel: () => {},
		}),
	);

	const latestFrame = frames.at(-1) || '';

	// Check for some descriptions
	t.regex(latestFrame, /Compact|default/i); // Tiny description
	t.regex(latestFrame, /Bold|blocky/i); // Block description

	unmount();
});
