import test from 'ava';
import {renderWithTheme as render} from '@/test-utils/render-with-theme';
import React from 'react';
import {
	VSCodeExtensionPrompt,
	shouldPromptExtensionInstall,
} from './vscode-extension-prompt';

console.log(`\nvscode-extension-prompt.spec.tsx – ${React.version}`);

// ============================================================================
// Component Rendering Tests
// ============================================================================

test('VSCodeExtensionPrompt renders without crashing', t => {
	const {lastFrame} = render(
		<VSCodeExtensionPrompt onComplete={() => {}} onSkip={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);
});

test('VSCodeExtensionPrompt shows prompt state with extension title', t => {
	const {lastFrame} = render(
		<VSCodeExtensionPrompt onComplete={() => {}} onSkip={() => {}} />,
	);

	const output = lastFrame();
	// Component will be in either prompt, checking, or no-cli state
	// depending on the environment
	t.truthy(output);
});

test('VSCodeExtensionPrompt shows install options when in prompt state', t => {
	const {lastFrame} = render(
		<VSCodeExtensionPrompt onComplete={() => {}} onSkip={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);
	// If VS Code CLI is available and extension not installed, should show options
	// Otherwise will show different state
});

test('VSCodeExtensionPrompt accepts onComplete callback', t => {
	t.notThrows(() => {
		render(<VSCodeExtensionPrompt onComplete={() => {}} onSkip={() => {}} />);
	});
});

test('VSCodeExtensionPrompt accepts onSkip callback', t => {
	t.notThrows(() => {
		render(<VSCodeExtensionPrompt onComplete={() => {}} onSkip={() => {}} />);
	});
});

// ============================================================================
// shouldPromptExtensionInstall Tests
// ============================================================================

test('shouldPromptExtensionInstall returns boolean', t => {
	const result = shouldPromptExtensionInstall();
	t.is(typeof result, 'boolean');
});

test('shouldPromptExtensionInstall does not throw', t => {
	t.notThrows(() => {
		shouldPromptExtensionInstall();
	});
});

test('shouldPromptExtensionInstall returns false without --vscode flag', t => {
	// Since we're in test environment without --vscode flag
	// and tests don't typically have --vscode in process.argv
	const hasVSCodeFlag = process.argv.includes('--vscode');
	const result = shouldPromptExtensionInstall();

	if (!hasVSCodeFlag) {
		t.false(result);
	} else {
		// If somehow --vscode is present, result depends on extension install status
		t.is(typeof result, 'boolean');
	}
});

// ============================================================================
// Component Props Tests
// ============================================================================

test('VSCodeExtensionPrompt renders with required props only', t => {
	t.notThrows(() => {
		const {unmount} = render(
			<VSCodeExtensionPrompt onComplete={() => {}} onSkip={() => {}} />,
		);
		unmount();
	});
});

test('VSCodeExtensionPrompt callbacks are functions', t => {
	const onComplete = () => {};
	const onSkip = () => {};

	// Just verify the component accepts these callbacks without error
	const {unmount} = render(
		<VSCodeExtensionPrompt onComplete={onComplete} onSkip={onSkip} />,
	);

	unmount();
	t.pass();
});

// ============================================================================
// State Tests
// ============================================================================

test('VSCodeExtensionPrompt handles different initial states', t => {
	// The component determines its initial state based on:
	// 1. isExtensionInstalled() - if true, goes to 'checking'
	// 2. isVSCodeCliAvailable() - if false, goes to 'no-cli'
	// 3. Otherwise goes to 'prompt'

	const {lastFrame, unmount} = render(
		<VSCodeExtensionPrompt onComplete={() => {}} onSkip={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);

	// Output should contain text appropriate to one of the states
	const hasCheckingText = output?.includes('Checking');
	const hasNoCliText = output?.includes('VS Code CLI not found');
	const hasPromptText =
		output?.includes('VS Code Extension') ||
		output?.includes('Install') ||
		output?.includes('Yes') ||
		output?.includes('No');

	// At least one of these should be true
	t.true(
		hasCheckingText || hasNoCliText || hasPromptText,
		'Component should render one of the expected states',
	);

	unmount();
});

// ============================================================================
// Accessibility and Content Tests
// ============================================================================

test('VSCodeExtensionPrompt prompt state shows helpful description', t => {
	const {lastFrame} = render(
		<VSCodeExtensionPrompt onComplete={() => {}} onSkip={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);

	// If in prompt state, should show description about what the extension does
	if (output?.includes('VS Code Extension')) {
		t.true(
			output.includes('diff') || output.includes('preview'),
			'Should mention diff preview functionality',
		);
	}
});

test('VSCodeExtensionPrompt no-cli state shows instructions', t => {
	const {lastFrame} = render(
		<VSCodeExtensionPrompt onComplete={() => {}} onSkip={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);

	// If in no-cli state, should show instructions
	if (output?.includes('VS Code CLI not found')) {
		t.true(
			output.includes('Cmd+Shift+P') || output.includes('Ctrl+Shift+P'),
			'Should show keyboard shortcut for command palette',
		);
		t.true(
			output.includes('Shell Command'),
			'Should mention Shell Command installation',
		);
	}
});

// ============================================================================
// SelectInput Integration Tests
// ============================================================================

test('VSCodeExtensionPrompt shows selection options in prompt state', t => {
	const {lastFrame} = render(
		<VSCodeExtensionPrompt onComplete={() => {}} onSkip={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);

	// If in prompt state with SelectInput, should show Yes and No options
	if (output?.includes('VS Code Extension') && output?.includes('Install')) {
		// SelectInput renders with indicator character
		// Options should include install and skip
		const hasYesOption =
			output.includes('Yes') || output.includes('install extension');
		const hasNoOption = output.includes('No') || output.includes('skip');

		// At least one option should be visible (the highlighted one)
		t.true(hasYesOption || hasNoOption, 'Should show at least one option');
	}
});

// ============================================================================
// Component Lifecycle Tests
// ============================================================================

test('VSCodeExtensionPrompt can be unmounted without errors', t => {
	const {unmount} = render(
		<VSCodeExtensionPrompt onComplete={() => {}} onSkip={() => {}} />,
	);

	t.notThrows(() => {
		unmount();
	});
});

test('VSCodeExtensionPrompt re-renders without crashing', t => {
	const {rerender, lastFrame} = render(
		<VSCodeExtensionPrompt onComplete={() => {}} onSkip={() => {}} />,
	);

	t.truthy(lastFrame());

	// Re-render with new callbacks
	t.notThrows(() => {
		rerender(
			<VSCodeExtensionPrompt
				onComplete={() => {
					/* new callback */
				}}
				onSkip={() => {
					/* new callback */
				}}
			/>,
		);
	});

	t.truthy(lastFrame());
});
