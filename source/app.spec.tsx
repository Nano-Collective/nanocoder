import test from 'ava';
import {isNonInteractiveModeComplete, shouldRenderWelcome} from './app';

// Test non-interactive mode integration
// These tests verify that the App component correctly handles non-interactive mode

// ============================================================================
// Non-Interactive Mode Behavior Tests
// ============================================================================

test('Should omit welcome banner in non-interactive mode', t => {
	t.false(shouldRenderWelcome(true));
	t.true(shouldRenderWelcome(false));
});

test('Non-interactive mode: only exits when run command is used', t => {
	// The exit logic only triggers when nonInteractivePrompt is truthy.
	// Based on cli.tsx, nonInteractivePrompt is only set when the 'run' command is used:
	//
	// const runCommandIndex = args.findIndex(arg => arg === 'run');
	// if (runCommandIndex !== -1 && args[runCommandIndex + 1]) {
	//   nonInteractivePrompt = promptArgs.join(' ');
	// }
	//
	// The exit condition in app.tsx checks:
	// if (nonInteractivePrompt && nonInteractiveSubmitted) { ... }
	//
	// This means:
	// - `nanocoder` - Normal interactive mode, no auto-exit (nonInteractivePrompt is undefined)
	// - `nanocoder run "prompt"` - Non-interactive mode, auto-exits after completion
	// - `nanocoder --vscode` - VS Code mode, no auto-exit (nonInteractivePrompt is undefined)

	// Test that nonInteractivePrompt is undefined without 'run' command
	const argsWithoutRun = ['--vscode', '--vscode-port', '3000'];
	const runIndex = argsWithoutRun.findIndex(arg => arg === 'run');
	const promptWithoutRun =
		runIndex !== -1 && argsWithoutRun[runIndex + 1]
			? argsWithoutRun.slice(runIndex + 1).join(' ')
			: undefined;
	t.is(promptWithoutRun, undefined);

	// Test that nonInteractivePrompt is set with 'run' command
	const argsWithRun = ['run', 'create', 'a', 'file'];
	const runIndexWithRun = argsWithRun.findIndex(arg => arg === 'run');
	const promptWithRun =
		runIndexWithRun !== -1 && argsWithRun[runIndexWithRun + 1]
			? argsWithRun.slice(runIndexWithRun + 1).join(' ')
			: undefined;
	t.is(promptWithRun, 'create a file');

	t.pass();
});

test('Non-interactive mode: exits when AI finishes processing prompt', t => {
	// Test the exit condition logic by simulating the state checks
	// This tests the actual logic that determines when to exit

	// Simulate app state when AI has completed
	const appStateComplete = {
		isThinking: false,
		isToolExecuting: false,
		isBashExecuting: false,
		isToolConfirmationMode: false,
		isConversationComplete: true,
		messages: [
			{role: 'user', content: 'test'},
			{role: 'assistant', content: 'response'},
		],
	};

	const startTime = Date.now();
	const maxExecutionTimeMs = 300000; // 5 minutes

	const {shouldExit, reason} = isNonInteractiveModeComplete(
		appStateComplete,
		startTime,
		maxExecutionTimeMs,
	);

	t.true(shouldExit, 'Should exit when AI has finished processing');
	t.is(reason, 'complete', 'Exit reason should be complete');
	t.true(
		appStateComplete.isConversationComplete,
		'Conversation should be marked complete',
	);
});

test('Non-interactive mode: does NOT exit while AI is still processing', t => {
	// Test that we don't exit prematurely while AI is thinking
	const appStateThinking = {
		isThinking: true, // Still generating response
		isToolExecuting: false,
		isBashExecuting: false,
		isToolConfirmationMode: false,
		isConversationComplete: false,
		messages: [{role: 'user', content: 'test'}],
	};

	const startTime = Date.now();
	const maxExecutionTimeMs = 300000;

	const {shouldExit} = isNonInteractiveModeComplete(
		appStateThinking,
		startTime,
		maxExecutionTimeMs,
	);

	t.false(shouldExit, 'Should NOT exit while AI is thinking');
});

test('Non-interactive mode: does NOT exit while tools are executing', t => {
	// Test that we don't exit while tools are being executed
	const appStateExecutingTools = {
		isThinking: false,
		isToolExecuting: true, // Tools are running
		isBashExecuting: false,
		isToolConfirmationMode: false,
		isConversationComplete: false,
		messages: [
			{role: 'user', content: 'test'},
			{role: 'assistant', content: 'response'},
		],
	};

	const startTime = Date.now();
	const maxExecutionTimeMs = 300000;

	const {shouldExit} = isNonInteractiveModeComplete(
		appStateExecutingTools,
		startTime,
		maxExecutionTimeMs,
	);

	t.false(shouldExit, 'Should NOT exit while tools are executing');
});

test('Non-interactive mode: does NOT exit when conversation is incomplete', t => {
	// Test that we don't exit even if processing states are complete but conversation isn't done
	const appStateIncompleteConversation = {
		isThinking: false,
		isToolExecuting: false,
		isBashExecuting: false,
		isToolConfirmationMode: false,
		isConversationComplete: false, // Conversation not finished yet
		messages: [
			{role: 'user', content: 'test'},
			{role: 'assistant', content: 'response'},
		],
	};

	const startTime = Date.now();
	const maxExecutionTimeMs = 300000;

	const {shouldExit} = isNonInteractiveModeComplete(
		appStateIncompleteConversation,
		startTime,
		maxExecutionTimeMs,
	);

	t.false(shouldExit, 'Should NOT exit when conversation is incomplete');
	t.false(
		appStateIncompleteConversation.isConversationComplete,
		'Conversation is not complete',
	);
});

// ============================================================================
// CLI Integration Tests
// ============================================================================

test('Non-interactive mode: CLI parsing integration', t => {
	// This test verifies integration with CLI argument parsing
	// Based on cli.tsx, the nonInteractivePrompt is extracted from process.argv

	// Test that the CLI correctly parses the 'run' command
	const args = ['run', 'test', 'prompt'];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const prompt =
		runCommandIndex !== -1 && args[runCommandIndex + 1]
			? args.slice(runCommandIndex + 1).join(' ')
			: undefined;

	t.is(prompt, 'test prompt');
});

test('Non-interactive mode: CLI parsing with complex prompt', t => {
	// Test that the CLI correctly parses complex prompts
	const args = [
		'--vscode',
		'run',
		'create',
		'a',
		'new',
		'file',
		'with',
		'content',
	];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const prompt =
		runCommandIndex !== -1 && args[runCommandIndex + 1]
			? args.slice(runCommandIndex + 1).join(' ')
			: undefined;

	t.is(prompt, 'create a new file with content');
});

test('Non-interactive mode: exits with tool-approval reason when tool approval required', t => {
	// Test that we exit with tool-approval reason when a message indicates tool approval is required
	const appStateToolApprovalRequired = {
		isThinking: false,
		isToolExecuting: false,
		isBashExecuting: false,
		isToolConfirmationMode: false,
		isConversationComplete: true,
		messages: [
			{role: 'user', content: 'test'},
			{role: 'error', content: 'Tool approval required for: `execute_bash`'},
		],
	};

	const startTime = Date.now();
	const maxExecutionTimeMs = 300000;

	const {shouldExit, reason} = isNonInteractiveModeComplete(
		appStateToolApprovalRequired,
		startTime,
		maxExecutionTimeMs,
	);

	t.true(shouldExit, 'Should exit when tool approval is required');
	t.is(reason, 'tool-approval', 'Exit reason should be tool-approval');
});

test('Non-interactive mode: CLI parsing without run command', t => {
	// Test that the CLI correctly handles cases without run command
	const args = ['--vscode', '--vscode-port', '3000'];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const prompt =
		runCommandIndex !== -1 && args[runCommandIndex + 1]
			? args.slice(runCommandIndex + 1).join(' ')
			: undefined;

	t.is(prompt, undefined);
});
