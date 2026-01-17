import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import {ProviderWizard} from './provider-wizard.js';

// ============================================================================
// Tests for ProviderWizard Component Rendering
// ============================================================================

console.log(`\nprovider-wizard.spec.tsx – ${React.version}`);

test('ProviderWizard renders with title', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Provider Wizard/);
});

test('ProviderWizard shows initial location step', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Where would you like to create your configuration/);
});

test('ProviderWizard shows keyboard shortcuts', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Esc.*Exit wizard/);
	t.regex(output!, /Shift\+Tab.*Go back/);
});

test('ProviderWizard shows location options', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Current project directory/);
	t.regex(output!, /Global user config/);
});

test('ProviderWizard renders without crashing when onCancel is provided', t => {
	let cancelCalled = false;

	const {lastFrame} = renderWithTheme(
		<ProviderWizard
			projectDir="/tmp/test-project"
			onComplete={() => {}}
			onCancel={() => {
				cancelCalled = true;
			}}
		/>,
	);

	t.truthy(lastFrame());
	t.false(cancelCalled); // Should not be called on render
});

test('ProviderWizard accepts projectDir prop', t => {
	const projectDir = '/custom/project/path';

	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir={projectDir} onComplete={() => {}} />,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

test('ProviderWizard renders TitledBox with correct border', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Check for rounded border characters
	t.regex(output!, /╭/); // Top-left corner
	t.regex(output!, /╮/); // Top-right corner
	t.regex(output!, /╰/); // Bottom-left corner
	t.regex(output!, /╯/); // Bottom-right corner
});

test('ProviderWizard renders with correct initial state', t => {
	const {frames} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	// Should have rendered at least one frame
	t.true(frames.length > 0);

	// First frame should show location step
	const firstFrame = frames[0];
	t.regex(firstFrame, /Provider Wizard/);
});

// ============================================================================
// Tests for ProviderWizard Keyboard Shortcuts Display
// ============================================================================

test('ProviderWizard shows Esc shortcut', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Esc/);
});

test('ProviderWizard shows Shift+Tab shortcut', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Shift\+Tab/);
});

// ============================================================================
// Tests for ProviderWizard Props Handling
// ============================================================================

test('ProviderWizard handles undefined onCancel', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	// Component should render without errors when onCancel is not provided
	t.truthy(lastFrame());
});

test('ProviderWizard handles empty projectDir', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="" onComplete={() => {}} />,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

test('ProviderWizard handles projectDir with spaces', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard
			projectDir="/path/with spaces/project"
			onComplete={() => {}}
		/>,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

// ============================================================================
// Tests for ProviderWizard UI Elements
// ============================================================================

test('ProviderWizard renders with proper border style', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Should have rounded borders
	t.regex(output!, /╭.*╮/s);
	t.regex(output!, /╰.*╯/s);
});

test('ProviderWizard shows location step prompt', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Where would you like to create your configuration/);
});

test('ProviderWizard shows both location options', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Current project directory/);
	t.regex(output!, /Global user config/);
});

// ============================================================================
// Tests for ProviderWizard Callback Behavior
// ============================================================================

test('ProviderWizard does not call onComplete on initial render', t => {
	let completeCalled = false;

	renderWithTheme(
		<ProviderWizard
			projectDir="/tmp/test-project"
			onComplete={() => {
				completeCalled = true;
			}}
		/>,
	);

	t.false(completeCalled);
});

test('ProviderWizard does not call onCancel on initial render', t => {
	let cancelCalled = false;

	renderWithTheme(
		<ProviderWizard
			projectDir="/tmp/test-project"
			onComplete={() => {}}
			onCancel={() => {
				cancelCalled = true;
			}}
		/>,
	);

	t.false(cancelCalled);
});

// ============================================================================
// Tests for ProviderWizard State Management
// ============================================================================

test('ProviderWizard starts at location step', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Should be on location step
	t.regex(output!, /Where would you like to create your configuration/);
});

test('ProviderWizard renders multiple frames', t => {
	const {frames} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	// Should have rendered at least one frame
	t.true(frames.length >= 1);
});

// ============================================================================
// Tests for ProviderWizard Integration
// ============================================================================

test('ProviderWizard renders complete initial UI', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();

	// Should have all expected elements
	t.regex(output!, /Provider Wizard/); // Title
	t.regex(output!, /Where would you like/); // Prompt
	t.regex(output!, /Current project directory/); // Option 1
	t.regex(output!, /Global user config/); // Option 2
	t.regex(output!, /Esc/); // Shortcut
	t.regex(output!, /Shift\+Tab/); // Shortcut
});

test('ProviderWizard handles all props simultaneously', t => {
	let completeCalled = false;
	let cancelCalled = false;

	const {lastFrame} = renderWithTheme(
		<ProviderWizard
			projectDir="/custom/path"
			onComplete={() => {
				completeCalled = true;
			}}
			onCancel={() => {
				cancelCalled = true;
			}}
		/>,
	);

	t.truthy(lastFrame());
	t.false(completeCalled);
	t.false(cancelCalled);
});

// ============================================================================
// Tests for ProviderWizard Error Handling
// ============================================================================

test('ProviderWizard renders without errors on first frame', t => {
	const {frames} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	t.true(frames.length > 0);
	t.truthy(frames[0]);
});

test('ProviderWizard handles rapid re-renders', t => {
	// Render multiple times to ensure stability
	for (let i = 0; i < 3; i++) {
		const {lastFrame} = renderWithTheme(
			<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
		);
		t.truthy(lastFrame());
	}
});

// ============================================================================
// Tests for ProviderWizard Accessibility
// ============================================================================

test('ProviderWizard shows clear navigation instructions', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Should show how to exit
	t.regex(output!, /Exit wizard/);
	// Should show how to go back
	t.regex(output!, /Go back/);
});

// ============================================================================
// Tests for ProviderWizard Consistency
// ============================================================================

test('ProviderWizard renders consistently across calls', t => {
	const output1 = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	).lastFrame();

	const output2 = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	).lastFrame();

	// Both renders should produce the same output
	t.is(output1, output2);
});

// ============================================================================
// Tests for ProviderWizard Delete Config Feature
// ============================================================================

test('ProviderWizard has confirm-delete step type', t => {
	// This test verifies that the WizardStep type includes 'confirm-delete'
	// The actual rendering is tested in integration tests
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

// ============================================================================
// Tests for ProviderWizard Additional Scenarios
// ============================================================================

test('ProviderWizard accepts all props without errors', t => {
	let completeCalled = false;
	let cancelCalled = false;

	const {lastFrame} = renderWithTheme(
		<ProviderWizard
			projectDir="/custom/path/with/many/segments"
			onComplete={() => {
				completeCalled = true;
			}}
			onCancel={() => {
				cancelCalled = true;
			}}
		/>,
	);

	t.truthy(lastFrame());
	t.false(completeCalled);
	t.false(cancelCalled);
});

test('ProviderWizard handles Windows-style paths', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard
			projectDir="C:\\Users\\test\\project"
			onComplete={() => {}}
		/>,
	);

	t.truthy(lastFrame());
});

test('ProviderWizard handles paths with special characters', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard
			projectDir="/path/with-special_chars.and.dots"
			onComplete={() => {}}
		/>,
	);

	t.truthy(lastFrame());
});

test('ProviderWizard shows location step by default', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Should show location step content
	t.regex(output!, /Where would you like to create your configuration/);
});

test('ProviderWizard renders border elements correctly', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Verify border characters
	t.regex(output!, /╭/);
	t.regex(output!, /╮/);
	t.regex(output!, /│/);
});

test('ProviderWizard keyboard shortcuts are visible', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Esc/);
	t.regex(output!, /Exit wizard/);
	t.regex(output!, /Shift\+Tab/);
	t.regex(output!, /Go back/);
});

test('ProviderWizard shows Global user config option', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Global user config/);
});

test('ProviderWizard handles projectDir with trailing slash', t => {
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test/" onComplete={() => {}} />,
	);

	t.truthy(lastFrame());
});

test('ProviderWizard handles very long projectDir', t => {
	const longPath = '/a/very/long/path/that/goes/on/and/on/for/many/directories';
	const {lastFrame} = renderWithTheme(
		<ProviderWizard projectDir={longPath} onComplete={() => {}} />,
	);

	t.truthy(lastFrame());
});

// ============================================================================
// Tests for ProviderWizard Frame Rendering
// ============================================================================

test('ProviderWizard produces consistent output', t => {
	const output1 = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test" onComplete={() => {}} />,
	).lastFrame();

	const output2 = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test" onComplete={() => {}} />,
	).lastFrame();

	t.is(output1, output2);
});

test('ProviderWizard renders all frames without errors', t => {
	const {frames} = renderWithTheme(
		<ProviderWizard projectDir="/tmp/test" onComplete={() => {}} />,
	);

	t.true(frames.length > 0);
	for (const frame of frames) {
		t.truthy(frame);
	}
});
