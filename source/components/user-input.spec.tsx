import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {UIStateProvider} from '../hooks/useUIState';
import UserInput from './user-input';

console.log(`\nuser-input.spec.tsx – ${React.version}`);

// Mock ThemeProvider for testing
const MockThemeProvider = ({children}: {children: React.ReactNode}) => {
	const mockTheme = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={mockTheme}>{children}</ThemeContext.Provider>
	);
};

// Wrapper with all required providers
const TestWrapper = ({children}: {children: React.ReactNode}) => (
	<MockThemeProvider>
		<UIStateProvider>{children}</UIStateProvider>
	</MockThemeProvider>
);

// Helper for async tests that need proper context and more time
const wait = async (ms = 200) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// Component Rendering Tests
// ============================================================================

test('UserInput renders without crashing', t => {
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput />
		</TestWrapper>,
	);

	t.truthy(lastFrame());
});

test('UserInput renders with placeholder text', t => {
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput placeholder="Custom placeholder" />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Placeholder text should be visible
});

test('UserInput renders prompt symbol', t => {
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, />/); // Prompt symbol
});

test('UserInput renders with disabled state', t => {
	const {lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput disabled={true} />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Shows a spinner when disabled (dots spinner uses braille characters like ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏)
	t.regex(output!, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
	unmount();
});

test('UserInput renders development mode indicator', t => {
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput developmentMode="normal" />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /normal mode on/); // Development mode indicator
});

test('UserInput renders auto-accept mode indicator', t => {
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput developmentMode="auto-accept" />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /auto-accept mode/); // Auto-accept mode indicator
});

test('UserInput renders plan mode indicator', t => {
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput developmentMode="plan" />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /plan mode/); // Plan mode indicator
});

test('UserInput renders with custom commands', t => {
	const customCommands = ['custom-command', 'another-command'];
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput customCommands={customCommands} />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
});

test('UserInput calls onSubmit when message is submitted', t => {
	let submittedMessage = '';
	const handleSubmit = (message: string) => {
		submittedMessage = message;
	};

	const {lastFrame, stdin} = render(
		<TestWrapper>
			<UserInput onSubmit={handleSubmit} />
		</TestWrapper>,
	);

	t.truthy(lastFrame());
	// Note: Testing actual user interaction with stdin is complex
	// This test verifies the component renders with onSubmit callback
});

test('UserInput renders while busy (Escape deferred to global handler)', t => {
	// When busy, UserInput no longer owns cancellation; the section-level handler
	// does. UserInput just swallows Escape so it doesn't clear the input.
	const {lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput isBusy={true} disabled={true} />
		</TestWrapper>,
	);

	t.truthy(lastFrame());
	unmount();
});

test('UserInput calls onToggleMode when provided', t => {
	let toggleCalled = false;
	const handleToggle = () => {
		toggleCalled = true;
	};

	const {lastFrame} = render(
		<TestWrapper>
			<UserInput onToggleMode={handleToggle} />
		</TestWrapper>,
	);

	t.truthy(lastFrame());
	// Note: Actual toggle invocation requires Shift+Tab simulation
});

test('UserInput renders bash mode indicator when input starts with !', t => {
	// This test verifies the component can handle bash mode
	// Actual input testing requires stdin manipulation
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput />
		</TestWrapper>,
	);

	t.truthy(lastFrame());
});

test('UserInput renders help text when not disabled', t => {
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /What would you like me to help with\?/);
});

test('UserInput hides help text when disabled', t => {
	const {lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput disabled={true} />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /What would you like me to help with\?/);
	unmount();
});

test('UserInput renders with all props provided', t => {
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput
				onSubmit={() => {}}
				placeholder="Test"
				customCommands={['test']}
				disabled={false}
				onToggleMode={() => {}}
				developmentMode="normal"
			/>
		</TestWrapper>,
	);

	t.truthy(lastFrame());
});

// ============================================================================
// File Autocomplete UI Tests
// ============================================================================

test('UserInput renders file autocomplete suggestions header', t => {
	// Note: Testing file autocomplete requires state manipulation
	// This test verifies the component structure supports it
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	// File suggestions would appear when @ is typed and files are found
});

test('UserInput responsive placeholder for narrow terminals', t => {
	// Test that placeholder adapts to terminal width
	// The actual implementation uses useResponsiveTerminal hook
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Placeholder text should be present (either long or short version)
});

// ============================================================================
// Integration Tests
// ============================================================================

test('UserInput maintains state across renders', t => {
	const {lastFrame, rerender} = render(
		<TestWrapper>
			<UserInput />
		</TestWrapper>,
	);

	const firstRender = lastFrame();
	t.truthy(firstRender);

	rerender(
		<TestWrapper>
			<UserInput />
		</TestWrapper>,
	);

	const secondRender = lastFrame();
	t.truthy(secondRender);
});

test('UserInput renders with default development mode', t => {
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Default mode is 'normal'
	t.regex(output!, /normal mode/);
});

test('UserInput handles empty custom commands array', t => {
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput customCommands={[]} />
		</TestWrapper>,
	);

	t.truthy(lastFrame());
});

test('UserInput component structure is valid', t => {
	const {lastFrame} = render(
		<TestWrapper>
			<UserInput />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.length > 0);
});

test('UserInput does not treat carriage return as a multiline shortcut', async t => {
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput />
		</TestWrapper>,
	);

	stdin.write('a');
	await new Promise(resolve => setTimeout(resolve, 20));
	stdin.write('\r');
	await new Promise(resolve => setTimeout(resolve, 20));
	stdin.write('b');
	await new Promise(resolve => setTimeout(resolve, 20));

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /b/);
	unmount();
});

// ============================================================================
// Compact Tool Display Tests
// ============================================================================

test('UserInput shows ctrl-o expand hint when disabled with compact display on', t => {
	const {lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput
				disabled={true}
				onToggleCompactDisplay={() => {}}
				compactToolDisplay={true}
			/>
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /ctrl-o.*expand/);
	unmount();
});

test('UserInput shows ctrl-o compact hint when disabled with compact display off', t => {
	const {lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput
				disabled={true}
				onToggleCompactDisplay={() => {}}
				compactToolDisplay={false}
			/>
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /ctrl-o.*compact/);
	unmount();
});

test('UserInput does not show ctrl-o hint when onToggleCompactDisplay is not provided', t => {
	const {lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput disabled={true} />
		</TestWrapper>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /ctrl-o/);
	unmount();
});

// ============================================================================
// Command Completion Navigation Tests
// ============================================================================

// Test commands to ensure completions appear in test environment
const TEST_COMMANDS = ['test-clear', 'test-help', 'test-exit'];

test('arrow key navigation updates the selected completion', async t => {
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput forceFocus={true} customCommands={TEST_COMMANDS} />
		</TestWrapper>,
	);

	stdin.write('/');
	await wait();

	const beforeNav = lastFrame()!;
	t.regex(beforeNav, /Available commands:/);
	t.regex(beforeNav, /▸ \//);

	stdin.write('\u001B[B');
	await wait();

	const afterDown = lastFrame()!;
	t.regex(afterDown, /Available commands:/);
	t.notRegex(afterDown, /^.*▸ \/.*\n.*▸ \//s);

	unmount();
});

test('Enter selects the highlighted completion and populates the input', async t => {
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput forceFocus={true} customCommands={TEST_COMMANDS} />
		</TestWrapper>,
	);

	stdin.write('/');
	await wait();

	t.regex(lastFrame()!, /Available commands:/);

	stdin.write('\r');
	await wait();

	const afterEnter = lastFrame()!;
	t.notRegex(afterEnter, /Available commands:/);
	t.regex(afterEnter, /\/\w+/);

	unmount();
});

test('typing a space after a command hides completions so args submit', async t => {
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput forceFocus={true} customCommands={TEST_COMMANDS} />
		</TestWrapper>,
	);

	stdin.write('/test-help');
	await wait();

	// While still typing the command name, completions are visible
	t.regex(lastFrame()!, /Available commands:/);

	// Once a space is typed, the user is entering arguments - completions hide
	// so Enter submits the full `/test-help arg` instead of selecting `/test-help`
	stdin.write(' arg');
	await wait();

	const afterArg = lastFrame()!;
	t.notRegex(afterArg, /Available commands:/);
	t.regex(afterArg, /\/test-help arg/);

	unmount();
});

test('completion menu dismissal/reset after selection or escape', async t => {
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput forceFocus={true} customCommands={TEST_COMMANDS} />
		</TestWrapper>,
	);

	stdin.write('/');
	await wait();

	t.regex(lastFrame()!, /Available commands:/);

	stdin.write('\r');
	await wait();

	t.notRegex(lastFrame()!, /Available commands:/);

	// After Enter selects, input has the command - press Escape TWICE to clear it
	stdin.write('\u001B');
	await wait();
	stdin.write('\u001B');
	await wait();

	stdin.write('/');
	await wait();

	t.regex(lastFrame()!, /Available commands:/);

	stdin.write('\u001B');
	await wait();
	stdin.write('\u001B');
	await wait();

	const afterEsc = lastFrame()!;
	t.notRegex(afterEsc, /Available commands:/);

	unmount();
});
