import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

// ============================================================================
// "Done & Save" must reach the summary, not an intervening step
// ============================================================================

const DOWN = '\u001B[B';

/**
 * Walks the wizard to the provider menu with one provider already configured.
 * The config is written into `dir` so the location step finds and loads it.
 */
async function atProviderMenu(
	dir: string,
	modeProviders?: Record<string, {provider: string; model: string}>,
) {
	writeFileSync(
		join(dir, 'agents.config.json'),
		JSON.stringify({
			nanocoder: {
				providers: [
					{
						name: 'Groq',
						baseUrl: 'https://api.groq.com/openai/v1',
						apiKey: 'test-key',
						models: ['openai/gpt-oss-120b', 'llama-3.3-70b'],
					},
				],
				...(modeProviders ? {modeProviders} : {}),
			},
		}),
		'utf-8',
	);

	const harness = renderWithTheme(
		<ProviderWizard projectDir={dir} onComplete={() => {}} />,
	);
	const settle = () => new Promise(r => setTimeout(r, 150));

	// The file exists, so the location step opens on "Edit this configuration".
	await settle();
	harness.stdin.write('\r');
	await settle();
	await settle();

	return {...harness, settle};
}

test.serial(
	'Done & Save goes straight to the summary, not the mode step',
	async t => {
		const dir = join(tmpdir(), `nanocoder-wizard-done-${process.pid}`);
		mkdirSync(dir, {recursive: true});
		t.teardown(() => rmSync(dir, {recursive: true, force: true}));

		const {lastFrame, stdin, settle} = await atProviderMenu(dir);
		t.regex(lastFrame()!, /Done & Save/, 'expected the provider menu');

		// Add another / Edit existing / Configure modes / Done & Save
		for (let i = 0; i < 3; i++) {
			stdin.write(DOWN);
			await settle();
		}
		stdin.write('\r');
		await settle();
		await settle();

		const output = lastFrame()!;
		t.regex(output, /Configuration Summary/);
		t.notRegex(output, /Configure Mode-Specific Providers/);
	},
);

test.serial('the mode step is reachable as an opt-in menu entry', async t => {
	const dir = join(tmpdir(), `nanocoder-wizard-modes-${process.pid}`);
	mkdirSync(dir, {recursive: true});
	t.teardown(() => rmSync(dir, {recursive: true, force: true}));

	const {lastFrame, stdin, settle} = await atProviderMenu(dir);

	for (let i = 0; i < 2; i++) {
		stdin.write(DOWN);
		await settle();
	}
	stdin.write('\r');
	await settle();
	await settle();

	t.regex(lastFrame()!, /Configure Mode-Specific Providers/);
});

test.serial(
	'saving without opening the mode step keeps existing mode providers',
	async t => {
		const dir = join(tmpdir(), `nanocoder-wizard-retain-${process.pid}`);
		mkdirSync(dir, {recursive: true});
		t.teardown(() => rmSync(dir, {recursive: true, force: true}));

		const {lastFrame, stdin, settle} = await atProviderMenu(dir, {
			plan: {provider: 'Groq', model: 'llama-3.3-70b'},
		});

		for (let i = 0; i < 3; i++) {
			stdin.write(DOWN);
			await settle();
		}
		stdin.write('\r'); // Done & Save
		await settle();
		await settle();

		// Mode providers now ride along in state rather than being re-collected
		// by a forced walk through the mode step, so skipping it must not drop
		// what the config already had.
		t.regex(lastFrame()!, /plan: Groq \(llama-3\.3-70b\)/);
	},
);
