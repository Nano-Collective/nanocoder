import type {Message, ToolCall} from '@/types/core';
import test from 'ava';
import {ConversationStateManager} from './conversation-state.js';

console.log('\napp/utils/conversationState.spec.ts');

// Helper to create mock tool calls
const createToolCall = (
	name: string,
	args: Record<string, any> = {},
): ToolCall => ({
	id: `call_${Math.random().toString(36).substring(7)}`,
	function: {
		name,
		arguments: args,
	},
});

// Tests for initializeState

test('initializeState: creates initial state for regular task', t => {
	const manager = new ConversationStateManager();
	const userMessage = 'Create a new React component';

	const state = manager.initializeState(userMessage);

	t.truthy(state);
	t.is(state.progress.originalTask, userMessage);
	t.is(state.progress.currentStep, 1);
	t.true(state.progress.totalEstimatedSteps > 1);
	t.deepEqual(state.progress.completedActions, []);
	t.is(state.progress.toolCallsExecuted, 0);
	t.is(state.progress.isRepeatingAction, false);
	t.is(state.toolExecutionCount, 0);
	t.deepEqual(state.recentToolCalls, []);
	t.true(state.conversationStartTime > 0);
});

test('initializeState: estimates steps for create tasks', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('Create a new API endpoint');

	t.is(state.progress.totalEstimatedSteps, 5);
});

test('initializeState: estimates steps for build tasks', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('Build a user authentication system');

	t.is(state.progress.totalEstimatedSteps, 5);
});

test('initializeState: estimates steps for implement tasks', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('Implement payment processing');

	t.is(state.progress.totalEstimatedSteps, 5);
});

test('initializeState: estimates steps for fix tasks', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('Fix the login bug');

	t.is(state.progress.totalEstimatedSteps, 4);
});

test('initializeState: estimates steps for debug tasks', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('Debug the memory leak');

	t.is(state.progress.totalEstimatedSteps, 4);
});

test('initializeState: estimates steps for troubleshoot tasks', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('Troubleshoot the deployment issue');

	t.is(state.progress.totalEstimatedSteps, 4);
});

test('initializeState: estimates steps for analyze tasks', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('Analyze the performance metrics');

	t.is(state.progress.totalEstimatedSteps, 3);
});

test('initializeState: estimates steps for understand tasks', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('Understand the codebase architecture');

	t.is(state.progress.totalEstimatedSteps, 3);
});

test('initializeState: estimates steps for explain tasks', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('Explain how the router works');

	t.is(state.progress.totalEstimatedSteps, 3);
});

test('initializeState: estimates steps for read tasks', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('Read the configuration file');

	t.is(state.progress.totalEstimatedSteps, 2);
});

test('initializeState: estimates steps for show tasks', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('Show me the test results');

	t.is(state.progress.totalEstimatedSteps, 2);
});

test('initializeState: estimates steps for list tasks', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('List all available commands');

	t.is(state.progress.totalEstimatedSteps, 2);
});

test('initializeState: estimates steps based on length for unknown tasks', t => {
	const manager = new ConversationStateManager();

	// Short message (< 50 chars) should get minimum of 3
	const shortState = manager.initializeState('Do something');
	t.is(shortState.progress.totalEstimatedSteps, 3);

	// Medium message (~100 chars) should get ceil(100/50) = 2, but min is 3
	const mediumMessage = 'a'.repeat(100);
	const mediumState = manager.initializeState(mediumMessage);
	t.is(mediumState.progress.totalEstimatedSteps, 3);

	// Long message (~400 chars) should get ceil(400/50) = 8 (capped at max)
	const longMessage = 'a'.repeat(400);
	const longState = manager.initializeState(longMessage);
	t.is(longState.progress.totalEstimatedSteps, 8);

	// Very long message (>400 chars) should be capped at 8
	const veryLongMessage = 'a'.repeat(500);
	const veryLongState = manager.initializeState(veryLongMessage);
	t.is(veryLongState.progress.totalEstimatedSteps, 8);
});

test('initializeState: detects simple greetings', t => {
	const manager = new ConversationStateManager();

	const greetings = [
		'hi',
		'hello',
		'hey',
		'hiya',
		'howdy',
		'good morning',
		'good afternoon',
		'good evening',
		"what's up",
		'whats up',
		'sup',
		'yo',
	];

	for (const greeting of greetings) {
		const state = manager.initializeState(greeting);
		t.is(state.progress.totalEstimatedSteps, 1, `Failed for greeting: "${greeting}"`);
	}
});

test('initializeState: detects greetings with punctuation', t => {
	const manager = new ConversationStateManager();

	const greetingsWithPunctuation = [
		'hi!',
		'hello!!',
		'hey?',
		'hello.',
		'hi!!!',
	];

	for (const greeting of greetingsWithPunctuation) {
		const state = manager.initializeState(greeting);
		t.is(state.progress.totalEstimatedSteps, 1, `Failed for greeting: "${greeting}"`);
	}
});

test('initializeState: does not treat non-greetings as simple greetings', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('highlight the important parts');

	t.true(state.progress.totalEstimatedSteps > 1);
});

// Tests for updateAfterToolExecution

test('updateAfterToolExecution: updates state after tool execution', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Create a file');

	const toolCall = createToolCall('write_file', {filename: 'test.txt'});
	manager.updateAfterToolExecution(toolCall, 'File created successfully');

	const state = manager.getState();
	t.truthy(state);
	t.is(state.progress.toolCallsExecuted, 1);
	t.is(state.progress.currentStep, 2);
	t.is(state.progress.completedActions.length, 1);
	t.is(state.toolExecutionCount, 1);
	t.is(state.recentToolCalls.length, 1);
	t.is(state.progress.lastToolCall, toolCall);
	t.is(state.progress.isRepeatingAction, false);
});

test('updateAfterToolExecution: tracks multiple tool executions', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Read and modify files');

	const toolCall1 = createToolCall('read_file', {filename: 'test.txt'});
	const toolCall2 = createToolCall('write_file', {filename: 'output.txt'});

	manager.updateAfterToolExecution(toolCall1, 'File contents');
	manager.updateAfterToolExecution(toolCall2, 'File written');

	const state = manager.getState();
	t.is(state!.progress.toolCallsExecuted, 2);
	t.is(state!.progress.currentStep, 3);
	t.is(state!.progress.completedActions.length, 2);
	t.is(state!.recentToolCalls.length, 2);
});

test('updateAfterToolExecution: limits recent tool calls to 5', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Multiple operations');

	// Execute 7 tools
	for (let i = 0; i < 7; i++) {
		const toolCall = createToolCall('read_file', {filename: `file${i}.txt`});
		manager.updateAfterToolExecution(toolCall, 'Success');
	}

	const state = manager.getState();
	t.is(state!.recentToolCalls.length, 5);
	// Should have the last 5 tool calls
	t.is(state!.recentToolCalls[0].function.arguments.filename, 'file2.txt');
	t.is(state!.recentToolCalls[4].function.arguments.filename, 'file6.txt');
});

test('updateAfterToolExecution: detects repetitive actions', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall1 = createToolCall('read_file', {filename: 'test.txt'});
	const toolCall2 = createToolCall('read_file', {filename: 'test.txt'}); // Same as toolCall1

	manager.updateAfterToolExecution(toolCall1, 'Result');
	t.is(manager.getState()!.progress.isRepeatingAction, false);

	// After second execution with same params, repetition is detected
	// recentToolCalls = [toolCall1, toolCall2], and toolCall2 matches toolCall1
	manager.updateAfterToolExecution(toolCall2, 'Result');
	t.is(manager.getState()!.progress.isRepeatingAction, true);
});

test('updateAfterToolExecution: does not detect repetition with less than 2 tool calls', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('read_file', {filename: 'test.txt'});
	manager.updateAfterToolExecution(toolCall, 'Result');

	t.is(manager.getState()!.progress.isRepeatingAction, false);
});

test('updateAfterToolExecution: increases total estimated steps when needed', t => {
	const manager = new ConversationStateManager();
	const state = manager.initializeState('Simple task'); // Gets low step count
	const initialEstimate = state.progress.totalEstimatedSteps;

	// Execute more tools than estimated
	for (let i = 0; i < initialEstimate + 2; i++) {
		const toolCall = createToolCall('read_file', {filename: `file${i}.txt`});
		manager.updateAfterToolExecution(toolCall, 'Success');
	}

	const finalState = manager.getState();
	t.true(finalState!.progress.totalEstimatedSteps > initialEstimate);
});

test('updateAfterToolExecution: describes read_file action', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('read_file', {filename: 'config.json'});
	manager.updateAfterToolExecution(toolCall, 'File contents');

	const state = manager.getState();
	t.is(state!.progress.completedActions[0], 'Read file: config.json');
});

test('updateAfterToolExecution: describes write_file action', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('write_file', {path: 'output.txt'});
	manager.updateAfterToolExecution(toolCall, 'Success');

	const state = manager.getState();
	t.is(state!.progress.completedActions[0], 'Created/wrote file: output.txt');
});

test('updateAfterToolExecution: describes create_file action', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('create_file', {filename: 'new.txt'});
	manager.updateAfterToolExecution(toolCall, 'Success');

	const state = manager.getState();
	t.is(state!.progress.completedActions[0], 'Created/wrote file: new.txt');
});

test('updateAfterToolExecution: describes edit_file action', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('edit_file', {filename: 'existing.txt'});
	manager.updateAfterToolExecution(toolCall, 'Success');

	const state = manager.getState();
	t.is(state!.progress.completedActions[0], 'Edited file: existing.txt');
});

test('updateAfterToolExecution: describes execute_bash action', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('execute_bash', {command: 'npm install'});
	manager.updateAfterToolExecution(toolCall, 'Success');

	const state = manager.getState();
	t.is(state!.progress.completedActions[0], 'Executed command: npm install');
});

test('updateAfterToolExecution: truncates long bash commands', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const longCommand = 'a'.repeat(100);
	const toolCall = createToolCall('execute_bash', {command: longCommand});
	manager.updateAfterToolExecution(toolCall, 'Success');

	const state = manager.getState();
	const description = state!.progress.completedActions[0];
	t.true(description.includes('...'));
	t.true(description.length < longCommand.length);
});

test('updateAfterToolExecution: describes unknown tools', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('custom_tool', {arg: 'value'});
	manager.updateAfterToolExecution(toolCall, 'Success');

	const state = manager.getState();
	t.is(state!.progress.completedActions[0], 'Used custom_tool');
});

test('updateAfterToolExecution: handles missing filename gracefully', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('read_file', {});
	manager.updateAfterToolExecution(toolCall, 'Success');

	const state = manager.getState();
	t.is(state!.progress.completedActions[0], 'Read file: unknown');
});

test('updateAfterToolExecution: does nothing when state is not initialized', t => {
	const manager = new ConversationStateManager();

	const toolCall = createToolCall('read_file', {filename: 'test.txt'});
	manager.updateAfterToolExecution(toolCall, 'Result');

	const state = manager.getState();
	t.is(state, null);
});

// Tests for updateAssistantMessage

test('updateAssistantMessage: updates assistant message in state', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const message: Message = {
		role: 'assistant',
		content: 'I will help you with that',
	};

	manager.updateAssistantMessage(message);

	const state = manager.getState();
	t.is(state!.lastAssistantMessage, message);
});

test('updateAssistantMessage: does nothing when state is not initialized', t => {
	const manager = new ConversationStateManager();

	const message: Message = {
		role: 'assistant',
		content: 'Test',
	};

	manager.updateAssistantMessage(message);

	const state = manager.getState();
	t.is(state, null);
});

// Tests for generateContinuationContext

test('generateContinuationContext: generates context with progress info', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Create a new feature');

	const context = manager.generateContinuationContext();

	t.true(context.includes('Step 1'));
	t.true(context.includes('Create a new feature'));
});

test('generateContinuationContext: includes recent actions', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall1 = createToolCall('read_file', {filename: 'file1.txt'});
	const toolCall2 = createToolCall('read_file', {filename: 'file2.txt'});
	const toolCall3 = createToolCall('read_file', {filename: 'file3.txt'});
	const toolCall4 = createToolCall('read_file', {filename: 'file4.txt'});

	manager.updateAfterToolExecution(toolCall1, 'Success');
	manager.updateAfterToolExecution(toolCall2, 'Success');
	manager.updateAfterToolExecution(toolCall3, 'Success');
	manager.updateAfterToolExecution(toolCall4, 'Success');

	const context = manager.generateContinuationContext();

	// Should include only last 3 actions
	t.true(context.includes('file2.txt'));
	t.true(context.includes('file3.txt'));
	t.true(context.includes('file4.txt'));
	t.false(context.includes('file1.txt'));
});

test('generateContinuationContext: includes repetition warning', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('read_file', {filename: 'test.txt'});
	manager.updateAfterToolExecution(toolCall, 'Success');
	manager.updateAfterToolExecution(toolCall, 'Success'); // Repeat

	const context = manager.generateContinuationContext();

	t.true(context.includes('⚠️ Warning'));
	t.true(context.includes('repeating'));
});

test('generateContinuationContext: suggests next steps after read_file', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('read_file', {filename: 'test.txt'});
	manager.updateAfterToolExecution(toolCall, 'Success');

	const context = manager.generateContinuationContext();

	t.true(context.includes('file contents'));
	t.true(context.includes('changes') || context.includes('analysis'));
});

test('generateContinuationContext: suggests next steps after execute_bash', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('execute_bash', {command: 'ls'});
	manager.updateAfterToolExecution(toolCall, 'Success');

	const context = manager.generateContinuationContext();

	t.true(context.includes('command output'));
});

test('generateContinuationContext: suggests next steps after write_file', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('write_file', {filename: 'test.txt'});
	manager.updateAfterToolExecution(toolCall, 'Success');

	const context = manager.generateContinuationContext();

	t.true(context.includes('testing') || context.includes('verifying'));
});

test('generateContinuationContext: suggests next steps after edit_file', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const toolCall = createToolCall('edit_file', {filename: 'test.txt'});
	manager.updateAfterToolExecution(toolCall, 'Success');

	const context = manager.generateContinuationContext();

	t.true(context.includes('testing') || context.includes('changes'));
});

test('generateContinuationContext: suggests completion when near end', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Short task');

	// Move progress to > 70% completion
	const state = manager.getState()!;
	const totalSteps = state.progress.totalEstimatedSteps;
	const targetStep = Math.ceil(totalSteps * 0.75);

	for (let i = 1; i < targetStep; i++) {
		const toolCall = createToolCall('read_file', {filename: `file${i}.txt`});
		manager.updateAfterToolExecution(toolCall, 'Success');
	}

	const context = manager.generateContinuationContext();

	t.true(context.includes('near completion') || context.includes('finalizing'));
});

test('generateContinuationContext: handles no tool calls', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	const context = manager.generateContinuationContext();

	t.true(context.includes('information you need'));
});

test('generateContinuationContext: returns empty string when state not initialized', t => {
	const manager = new ConversationStateManager();

	const context = manager.generateContinuationContext();

	t.is(context, '');
});

// Tests for getState

test('getState: returns current state', t => {
	const manager = new ConversationStateManager();
	const initialState = manager.initializeState('Task');

	const state = manager.getState();

	t.is(state, initialState);
});

test('getState: returns null when not initialized', t => {
	const manager = new ConversationStateManager();

	const state = manager.getState();

	t.is(state, null);
});

// Tests for reset

test('reset: clears state', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('Task');

	manager.reset();

	const state = manager.getState();
	t.is(state, null);
});

test('reset: allows reinitialization after reset', t => {
	const manager = new ConversationStateManager();
	manager.initializeState('First task');
	manager.reset();

	const newState = manager.initializeState('Second task');

	t.truthy(newState);
	t.is(newState.progress.originalTask, 'Second task');
	t.is(newState.progress.currentStep, 1);
});

// Integration tests

test('full conversation flow: tracks progress correctly', t => {
	const manager = new ConversationStateManager();

	// Initialize
	const state = manager.initializeState('Build a REST API');
	t.is(state.progress.totalEstimatedSteps, 5);

	// Execute several tools
	const toolCall1 = createToolCall('read_file', {filename: 'package.json'});
	manager.updateAfterToolExecution(toolCall1, 'Contents');

	const toolCall2 = createToolCall('write_file', {filename: 'api.ts'});
	manager.updateAfterToolExecution(toolCall2, 'Created');

	const toolCall3 = createToolCall('execute_bash', {command: 'npm test'});
	manager.updateAfterToolExecution(toolCall3, 'Tests passed');

	// Update assistant message
	const message: Message = {
		role: 'assistant',
		content: 'API created successfully',
	};
	manager.updateAssistantMessage(message);

	// Check final state
	const finalState = manager.getState()!;
	t.is(finalState.progress.currentStep, 4); // Started at 1, executed 3 tools
	t.is(finalState.progress.toolCallsExecuted, 3);
	t.is(finalState.toolExecutionCount, 3);
	t.is(finalState.progress.completedActions.length, 3);
	t.is(finalState.lastAssistantMessage, message);

	// Generate continuation context
	const context = manager.generateContinuationContext();
	t.true(context.includes('Build a REST API'));
	t.true(context.includes('Step 4'));
});
