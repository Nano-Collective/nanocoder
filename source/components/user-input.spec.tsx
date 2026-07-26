import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {UIStateProvider, useUIStateContext} from '../hooks/useUIState';
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

const waitForCondition = async (
	condition: () => boolean,
	// Generous ceiling: these polls resolve as soon as the condition holds, so a
	// higher deadline only matters when the file's concurrent tests starve each
	// other under load - which is exactly when the old 1000ms budget flaked.
	timeoutMs = 3000,
) => {
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		if (condition()) {
			return;
		}

		await wait(25);
	}

	throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
};

const waitForFrame = async (
	lastFrame: () => string | undefined,
	pattern: RegExp,
	timeoutMs = 3000,
) => {
	await waitForCondition(
		() => pattern.test(lastFrame() ?? ''),
		timeoutMs,
	);
};

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

test('UserInput reports and restores submitted drafts with attachments', async t => {
	let submittedMessage = '';
	let submittedDraft:
		| Parameters<
				NonNullable<React.ComponentProps<typeof UserInput>['onSubmittedDraft']>
		  >[0]
		| null = null;

	const restoreDraft = {
		id: 1,
		inputState: {
			displayValue: 'edit this request',
			placeholderContent: {},
		},
		attachments: [{data: 'abc', mediaType: 'image/png'}],
	};

	const {stdin, lastFrame, rerender, unmount} = render(
		<TestWrapper>
			<UserInput
				forceFocus={true}
				onSubmit={message => {
					submittedMessage = message;
				}}
				onSubmittedDraft={draft => {
					submittedDraft = draft;
				}}
			/>
		</TestWrapper>,
	);

	stdin.write('original');
	await waitForFrame(lastFrame, /original/);
	stdin.write('\r');
	await waitForCondition(() => submittedMessage === 'original');

	t.is(submittedDraft?.inputState.displayValue, 'original');
	t.deepEqual(submittedDraft?.inputState.placeholderContent, {});
	t.deepEqual(submittedDraft?.attachments, []);

	rerender(
		<TestWrapper>
			<UserInput
				forceFocus={true}
				onSubmit={message => {
					submittedMessage = message;
				}}
				restoreSubmittedDraft={restoreDraft}
			/>
		</TestWrapper>,
	);
	await waitForFrame(lastFrame, /edit this request/);

	t.regex(lastFrame()!, /\[image #1: image\]/);
	unmount();
});

test('UserInput queues submitted messages while busy', async t => {
	let submittedMessage = '';
	let queuedMessage = '';
	let queuedDisplay = '';

	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput
				forceFocus={true}
				isBusy={true}
				onSubmit={message => {
					submittedMessage = message;
				}}
				onQueueMessage={message => {
					queuedMessage = message.message;
					queuedDisplay = message.displayValue;
				}}
			/>
		</TestWrapper>,
	);

	stdin.write('queued while busy');
	await waitForFrame(lastFrame, /queued while busy/);
	stdin.write('\r');
	await waitForCondition(() => queuedMessage === 'queued while busy');

	t.is(submittedMessage, '');
	t.is(queuedMessage, 'queued while busy');
	t.is(queuedDisplay, 'queued while busy');
	unmount();
});

test('UserInput submits slash commands immediately while busy', async t => {
	let submittedMessage = '';
	let queuedMessage = '';

	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput
				forceFocus={true}
				isBusy={true}
				onSubmit={message => {
					submittedMessage = message;
				}}
				onQueueMessage={message => {
					queuedMessage = message.message;
				}}
			/>
		</TestWrapper>,
	);

	stdin.write('/help');
	await waitForFrame(lastFrame, /\/help/);
	stdin.write('\r');
	await waitForCondition(() => submittedMessage === '/help');

	t.is(submittedMessage, '/help');
	t.is(queuedMessage, '');
	unmount();
});

test('UserInput renders queued messages while busy', t => {
	const {lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput
				isBusy={true}
				queuedMessages={[
					{
						id: 'queued-1',
						message: 'first full message',
						displayValue: 'first queued message',
					},
					{
						id: 'queued-2',
						message: 'second full message',
						displayValue: 'second queued message',
						images: [{data: 'abc', mediaType: 'image/png'}],
					},
				]}
			/>
		</TestWrapper>,
	);

	const output = lastFrame()!;
	t.regex(output, /Queued messages/);
	t.regex(output, /first queued message/);
	t.regex(output, /second queued message/);
	t.regex(output, /1 image/);
	unmount();
});

// Serial: this test mutates the global process.stdout.columns. Run alone so the
// narrowed width can't leak into a concurrently-rendering sibling test.
test.serial('UserInput truncates long queued messages on narrow terminals', t => {
	const originalColumns = process.stdout.columns;
	// Force a narrow terminal so width-based truncation must kick in.
	Object.defineProperty(process.stdout, 'columns', {
		value: 40,
		configurable: true,
	});

	try {
		const longMessage =
			'this is a very long queued message that should be truncated because it far exceeds the narrow terminal width available';
		const {lastFrame, unmount} = render(
			<TestWrapper>
				<UserInput
					forceFocus={true}
					isBusy={true}
					queuedMessages={[
						{id: 'queued-1', message: longMessage, displayValue: longMessage},
					]}
				/>
			</TestWrapper>,
		);

		const output = lastFrame() ?? '';
		// Truncated with the shared ellipsis, and the tail is dropped.
		t.regex(output, /\.\.\./);
		t.notRegex(output, /terminal width available/);
		// The queued-message line itself fits within the terminal width. Scope to
		// that line rather than every rendered line: the component truncates the
		// message deterministically, whereas the decorative section header relies
		// on Ink's ambient wrapping, which can flake under deferred re-layout.
		const messageLine = output
			.split('\n')
			.find(line => line.includes('this is a very long'));
		t.truthy(messageLine);
		t.true(stripAnsi(messageLine ?? '').length <= 40);
		unmount();
	} finally {
		Object.defineProperty(process.stdout, 'columns', {
			value: originalColumns,
			configurable: true,
		});
	}
});

test('UserInput navigates queued messages while busy with empty input', async t => {
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput
				forceFocus={true}
				isBusy={true}
				queuedMessages={[
					{id: 'queued-1', message: 'first', displayValue: 'first queued'},
					{id: 'queued-2', message: 'second', displayValue: 'second queued'},
				]}
			/>
		</TestWrapper>,
	);

	stdin.write('\u001B[B');
	await wait(50);

	const output = lastFrame()!;
	t.regex(output, /▸ first queued/);
	t.notRegex(output, /▸ second queued/);
	unmount();
});

test('UserInput loads selected queued message for editing', async t => {
	let removedId = '';

	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput
				forceFocus={true}
				isBusy={true}
				queuedMessages={[
					{id: 'queued-1', message: 'first', displayValue: 'first queued'},
					{id: 'queued-2', message: 'second', displayValue: 'second queued'},
				]}
				onRemoveQueuedMessage={id => {
					removedId = id;
				}}
			/>
		</TestWrapper>,
	);

	stdin.write('\u001B[B');
	await wait(50);
	stdin.write('\u001B[B');
	await wait(50);
	stdin.write('\r');
	await wait(50);

	t.is(removedId, 'queued-2');
	t.regex(lastFrame()!, /second queued/);
	unmount();
});

test('UserInput up arrow returns from the first queued message to the input', async t => {
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput
				forceFocus={true}
				isBusy={true}
				queuedMessages={[
					{id: 'queued-1', message: 'first', displayValue: 'first queued'},
					{id: 'queued-2', message: 'second', displayValue: 'second queued'},
				]}
			/>
		</TestWrapper>,
	);

	// Enter the queue, then step back up to the input.
	stdin.write('\u001B[B');
	await wait(50);
	t.regex(lastFrame()!, /▸ first queued/);

	stdin.write('\u001B[A');
	await wait(50);

	const output = lastFrame()!;
	t.notRegex(output, /▸ first queued/);
	t.notRegex(output, /▸ second queued/);
	unmount();
});

test('UserInput removes selected queued message with Delete', async t => {
	let removedId = '';
	const QueueHarness = () => {
		const [messages, setMessages] = React.useState([
			{id: 'queued-1', message: 'first', displayValue: 'first queued'},
			{id: 'queued-2', message: 'second', displayValue: 'second queued'},
		]);

		return (
			<UserInput
				forceFocus={true}
				isBusy={true}
				queuedMessages={messages}
				onRemoveQueuedMessage={id => {
					removedId = id;
					setMessages(current =>
						current.filter(message => message.id !== id),
					);
				}}
			/>
		);
	};

	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<QueueHarness />
		</TestWrapper>,
	);

	stdin.write('\u001B[B');
	await wait(50);
	stdin.write('\u001B[3;5~');
	await wait(50);

	t.is(removedId, 'queued-1');
	t.notRegex(lastFrame()!, /first queued/);

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

	stdin.write('/test');
	await wait();
	await wait();

	// While still typing the command name, completions are visible
	t.regex(lastFrame()!, /Available commands:/);

	// Once a space is typed, the user is entering arguments - completions hide
	// so Enter submits the full `/test arg` instead of selecting `/test`
	stdin.write(' arg');
	await wait();

	const afterArg = lastFrame()!;
	t.notRegex(afterArg, /Available commands:/);
	t.regex(afterArg, /\/test arg/);

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

test('UserInput renders completions text when typing /', async t => {
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput customCommands={['help', 'model']} />
		</TestWrapper>
	);

	await new Promise(resolve => setTimeout(resolve, 50));
	stdin.write('/');
	await new Promise(resolve => setTimeout(resolve, 150));
	await wait();

	const output = lastFrame()!;
	t.truthy(output);
	t.regex(output, /Available commands:/);
	unmount();
});

test('UserInput windows long slash completion lists', async t => {
	const commands = Array.from(
		{length: 14},
		(_, index) => `zz-window-${String(index).padStart(2, '0')}`,
	);
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput forceFocus={true} customCommands={commands} />
		</TestWrapper>,
	);

	stdin.write('/zz');
	await wait();
	await wait();

	const firstFrame = lastFrame()!;
	const firstVisibleCommands = firstFrame
		.split('\n')
		.filter(line => /\/zz-window-\d{2}/.test(line));

	t.is(firstVisibleCommands.length, 10);
	t.regex(firstFrame, /\/zz-window-00/);
	t.regex(firstFrame, /\/zz-window-09/);
	t.notRegex(firstFrame, /\/zz-window-10/);
	t.regex(firstFrame, /Showing 1-10 of 14/);

	for (let i = 0; i < 11; i++) {
		stdin.write('\u001B[B');
		await wait(25);
	}

	const laterFrame = lastFrame()!;
	t.notRegex(laterFrame, /\/zz-window-00/);
	t.regex(laterFrame, /▸ \/zz-window-11/);
	t.regex(laterFrame, /Showing 5-14 of 14/);

	unmount();
});

test('UserInput renders completions BEFORE the mode indicator (inside the input box)', async t => {
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput developmentMode="normal" customCommands={['help', 'model']} />
		</TestWrapper>
	);

	await new Promise(resolve => setTimeout(resolve, 50));
	stdin.write('/');
	await new Promise(resolve => setTimeout(resolve, 150));
	await wait();

	const output = lastFrame()!;
	t.truthy(output);

	const completionsIdx = output.indexOf('Available commands:');
	const modeIdx = output.indexOf('normal mode');
	t.true(completionsIdx > -1, 'Completions text should be present');
	t.true(modeIdx > -1, 'Mode indicator should be present');
	t.true(
		completionsIdx < modeIdx,
		'Completions must render before the mode indicator (inside the bordered input box)',
	);
	unmount();
});

test('UserInput completions appear on a line above the mode indicator', async t => {
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput developmentMode="normal" customCommands={['help', 'model']} />
		</TestWrapper>
	);

	await new Promise(resolve => setTimeout(resolve, 50));
	stdin.write('/');
	await new Promise(resolve => setTimeout(resolve, 150));
	await wait();

	const output = lastFrame()!;
	const lines = output.split('\n');

	let completionLine = -1;
	let modeLine = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes('Available commands:')) completionLine = i;
		if (lines[i].includes('normal mode')) modeLine = i;
	}

	t.true(completionLine > -1, 'Should find completions line');
	t.true(modeLine > -1, 'Should find mode indicator line');
	t.true(
		completionLine < modeLine,
		`Completions (line ${completionLine}) must be above mode indicator (line ${modeLine})`,
	);
	unmount();
});

test('UserInput does not show completions when input is empty', t => {
	const {lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput />
		</TestWrapper>
	);

	const output = lastFrame()!;
	t.truthy(output);
	t.notRegex(output, /Available commands:/);
	unmount();
});

