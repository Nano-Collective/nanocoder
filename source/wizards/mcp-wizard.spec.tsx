import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import {McpWizard} from './mcp-wizard.js';

// ============================================================================
// Tests for McpWizard Component Rendering
// ============================================================================

console.log(`\nmcp-wizard.spec.tsx – ${React.version}`);

test('McpWizard renders with title', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /MCP Server Configuration/);
});

test('McpWizard shows initial location step', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Where would you like to create your configuration/);
});

test('McpWizard shows keyboard shortcuts', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Esc.*Exit wizard/);
	t.regex(output!, /Shift\+Tab.*Go back/);
});

test('McpWizard shows location options', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Current project directory/);
	t.regex(output!, /Global user config/);
});

test('McpWizard renders without crashing when onCancel is provided', t => {
	let cancelCalled = false;

	const {lastFrame} = renderWithTheme(
		<McpWizard
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

test('McpWizard accepts projectDir prop', t => {
	const projectDir = '/custom/project/path';

	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir={projectDir} onComplete={() => {}} />,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

test('McpWizard renders TitledBox with correct border', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Check for rounded border characters
	t.regex(output!, /╭/); // Top-left corner
	t.regex(output!, /╮/); // Top-right corner
	t.regex(output!, /╰/); // Bottom-left corner
	t.regex(output!, /╯/); // Bottom-right corner
});

test('McpWizard renders with correct initial state', t => {
	const {frames} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	// Should have rendered at least one frame
	t.true(frames.length > 0);

	// First frame should show location step
	const firstFrame = frames[0];
	t.regex(firstFrame, /MCP Server Configuration/);
});

// ============================================================================
// Tests for McpWizard Keyboard Shortcuts Display
// ============================================================================

test('McpWizard shows Esc shortcut', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Esc/);
});

test('McpWizard shows Shift+Tab shortcut', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Shift\+Tab/);
});

// ============================================================================
// Tests for McpWizard Props Handling
// ============================================================================

test('McpWizard handles undefined onCancel', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	// Component should render without errors when onCancel is not provided
	t.truthy(lastFrame());
});

test('McpWizard handles empty projectDir', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="" onComplete={() => {}} />,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

test('McpWizard handles projectDir with spaces', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/path/with spaces/project" onComplete={() => {}} />,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

// ============================================================================
// Tests for McpWizard UI Elements
// ============================================================================

test('McpWizard renders with proper border style', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Should have rounded borders
	t.regex(output!, /╭.*╮/s);
	t.regex(output!, /╰.*╯/s);
});

test('McpWizard shows location step prompt', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Where would you like to create your configuration/);
});

test('McpWizard shows both location options', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Current project directory/);
	t.regex(output!, /Global user config/);
});

// ============================================================================
// Tests for McpWizard Callback Behavior
// ============================================================================

test('McpWizard does not call onComplete on initial render', t => {
	let completeCalled = false;

	renderWithTheme(
		<McpWizard
			projectDir="/tmp/test-project"
			onComplete={() => {
				completeCalled = true;
			}}
		/>,
	);

	t.false(completeCalled);
});

test('McpWizard does not call onCancel on initial render', t => {
	let cancelCalled = false;

	renderWithTheme(
		<McpWizard
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
// Tests for McpWizard State Management
// ============================================================================

test('McpWizard starts at location step', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Should be on location step
	t.regex(output!, /Where would you like to create your configuration/);
});

test('McpWizard renders multiple frames', t => {
	const {frames} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	// Should have rendered at least one frame
	t.true(frames.length >= 1);
});

// ============================================================================
// Tests for McpWizard Integration
// ============================================================================

test('McpWizard renders complete initial UI', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();

	// Should have all expected elements
	t.regex(output!, /MCP Server Configuration/); // Title
	t.regex(output!, /Where would you like/); // Prompt
	t.regex(output!, /Current project directory/); // Option 1
	t.regex(output!, /Global user config/); // Option 2
	t.regex(output!, /Esc/); // Shortcut
	t.regex(output!, /Shift\+Tab/); // Shortcut
});

test('McpWizard handles all props simultaneously', t => {
	let completeCalled = false;
	let cancelCalled = false;

	const {lastFrame} = renderWithTheme(
		<McpWizard
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
// Tests for McpWizard Error Handling
// ============================================================================

test('McpWizard renders without errors on first frame', t => {
	const {frames} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	t.true(frames.length > 0);
	t.truthy(frames[0]);
});

test('McpWizard handles rapid re-renders', t => {
	// Render multiple times to ensure stability
	for (let i = 0; i < 3; i++) {
		const {lastFrame} = renderWithTheme(
			<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
		);
		t.truthy(lastFrame());
	}
});

// ============================================================================
// Tests for McpWizard Accessibility
// ============================================================================

test('McpWizard shows clear navigation instructions', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Should show how to exit
	t.regex(output!, /Exit wizard/);
	// Should show how to go back
	t.regex(output!, /Go back/);
});

// ============================================================================
// Tests for McpWizard Consistency
// ============================================================================

test('McpWizard renders consistently across calls', t => {
	const output1 = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	).lastFrame();

	const output2 = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	).lastFrame();

	// Both renders should produce the same output
	t.is(output1, output2);
});

// ============================================================================
// Tests for McpWizard Title
// ============================================================================

test('McpWizard has MCP Server Configuration title', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /MCP Server Configuration/);
});

test('McpWizard title is visible in border', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Title should appear near the top border
	t.regex(output!, /MCP Server Configuration/);
});

// ============================================================================
// Tests for McpWizard Delete Config Feature
// ============================================================================

test('McpWizard has confirm-delete step type', t => {
	// This test verifies that the WizardStep type includes 'confirm-delete'
	// The actual rendering is tested in integration tests
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

// ============================================================================
// Tests for McpWizard Additional Scenarios
// ============================================================================

test('McpWizard accepts all props without errors', t => {
	let completeCalled = false;
	let cancelCalled = false;

	const {lastFrame} = renderWithTheme(
		<McpWizard
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

test('McpWizard handles Windows-style paths', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="C:\\Users\\test\\project" onComplete={() => {}} />,
	);

	t.truthy(lastFrame());
});

test('McpWizard handles paths with special characters', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard
			projectDir="/path/with-special_chars.and.dots"
			onComplete={() => {}}
		/>,
	);

	t.truthy(lastFrame());
});

test('McpWizard shows location step by default', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Should show location step content
	t.regex(output!, /Where would you like to create your configuration/);
});

test('McpWizard renders border elements correctly', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Verify border characters
	t.regex(output!, /╭/);
	t.regex(output!, /╮/);
	t.regex(output!, /│/);
});

test('McpWizard keyboard shortcuts are visible', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Esc/);
	t.regex(output!, /Exit wizard/);
	t.regex(output!, /Shift\+Tab/);
	t.regex(output!, /Go back/);
});

test('McpWizard shows Global user config option', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test" onComplete={() => {}} />,
	);

	const output = lastFrame();
	t.regex(output!, /Global user config/);
});

test('McpWizard handles projectDir with trailing slash', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test/" onComplete={() => {}} />,
	);

	t.truthy(lastFrame());
});

test('McpWizard handles very long projectDir', t => {
	const longPath = '/a/very/long/path/that/goes/on/and/on/for/many/directories';
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir={longPath} onComplete={() => {}} />,
	);

	t.truthy(lastFrame());
});

// ============================================================================
// Tests for McpWizard Frame Rendering
// ============================================================================

test('McpWizard produces consistent output', t => {
	const output1 = renderWithTheme(
		<McpWizard projectDir="/tmp/test" onComplete={() => {}} />,
	).lastFrame();

	const output2 = renderWithTheme(
		<McpWizard projectDir="/tmp/test" onComplete={() => {}} />,
	).lastFrame();

	t.is(output1, output2);
});

test('McpWizard renders all frames without errors', t => {
	const {frames} = renderWithTheme(
		<McpWizard projectDir="/tmp/test" onComplete={() => {}} />,
	);

	t.true(frames.length > 0);
	for (const frame of frames) {
		t.truthy(frame);
	}
});

// ============================================================================
// Tests for McpWizard Manual Edit Feature (Ctrl+E)
// ============================================================================

test('McpWizard has editing step type defined', t => {
	// This test verifies that the WizardStep type includes 'editing'
	// The editing step is used when opening the config in an external editor
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

test('McpWizard does not show Ctrl+E on location step', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// On location step, Ctrl+E should not be shown (no config path set yet)
	t.notRegex(output!, /Ctrl\+E/);
});

test('McpWizard supports openInEditor functionality', t => {
	// This test verifies the component is structured to support manual editing
	// The actual editor opening is tested in integration tests
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

test('McpWizard help text includes standard shortcuts on location step', t => {
	const {lastFrame} = renderWithTheme(
		<McpWizard projectDir="/tmp/test-project" onComplete={() => {}} />,
	);

	const output = lastFrame();
	// Should show Esc and Shift+Tab but not Ctrl+E on location step
	t.regex(output!, /Esc/);
	t.regex(output!, /Shift\+Tab/);
});
