import test from 'ava';
import {
	subagentProgress,
	updateSubagentProgress,
	resetSubagentProgress,
} from './subagent-events.js';

console.log('\nsubagent-events.spec.ts');

test.serial('updateSubagentProgress updates all fields', t => {
	updateSubagentProgress({
		subagentName: 'research',
		status: 'tool_call',
		currentTool: 'read_file',
		toolCallCount: 3,
		turnCount: 2,
		tokenCount: 500,
	});

	t.is(subagentProgress.subagentName, 'research');
	t.is(subagentProgress.status, 'tool_call');
	t.is(subagentProgress.currentTool, 'read_file');
	t.is(subagentProgress.toolCallCount, 3);
	t.is(subagentProgress.turnCount, 2);
	t.is(subagentProgress.tokenCount, 500);
});

test.serial('resetSubagentProgress resets to defaults', t => {
	// Set non-default values first
	updateSubagentProgress({
		subagentName: 'research',
		status: 'complete',
		currentTool: 'read_file',
		toolCallCount: 10,
		turnCount: 5,
		tokenCount: 2000,
	});

	resetSubagentProgress();

	t.is(subagentProgress.subagentName, '');
	t.is(subagentProgress.status, 'running');
	t.is(subagentProgress.currentTool, undefined);
	t.is(subagentProgress.toolCallCount, 0);
	t.is(subagentProgress.turnCount, 0);
	t.is(subagentProgress.tokenCount, 0);
});

test.serial('updateSubagentProgress preserves partial updates', t => {
	resetSubagentProgress();

	updateSubagentProgress({
		subagentName: 'research',
		status: 'running',
		toolCallCount: 0,
		turnCount: 1,
		tokenCount: 100,
	});

	t.is(subagentProgress.currentTool, undefined);
	t.is(subagentProgress.tokenCount, 100);

	updateSubagentProgress({
		subagentName: 'research',
		status: 'tool_call',
		currentTool: 'find_files',
		toolCallCount: 1,
		turnCount: 1,
		tokenCount: 150,
	});

	t.is(subagentProgress.currentTool, 'find_files');
	t.is(subagentProgress.tokenCount, 150);
});
