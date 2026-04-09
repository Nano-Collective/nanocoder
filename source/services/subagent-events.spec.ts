import test from 'ava';
import {
	clearAllSubagentProgress,
	getAllSubagentProgress,
	getSubagentProgress,
	removeSubagentProgress,
	resetSubagentProgress,
	resetSubagentProgressById,
	subagentProgress,
	updateSubagentProgress,
	updateSubagentProgressById,
} from './subagent-events.js';

console.log('\nsubagent-events.spec.ts');

// ============================================================================
// Legacy single-agent API
// ============================================================================

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

// ============================================================================
// Multi-agent progress tracking
// ============================================================================

test.serial('resetSubagentProgressById creates a fresh entry', t => {
	clearAllSubagentProgress();

	resetSubagentProgressById('agent-1');
	const progress = getSubagentProgress('agent-1');

	t.is(progress.subagentName, '');
	t.is(progress.status, 'running');
	t.is(progress.toolCallCount, 0);
	t.is(progress.turnCount, 0);
	t.is(progress.tokenCount, 0);
});

test.serial(
	'updateSubagentProgressById updates agent-specific slot',
	t => {
		clearAllSubagentProgress();

		resetSubagentProgressById('agent-1');
		resetSubagentProgressById('agent-2');

		updateSubagentProgressById('agent-1', {
			subagentName: 'research',
			status: 'tool_call',
			currentTool: 'read_file',
			toolCallCount: 3,
			turnCount: 1,
			tokenCount: 500,
		});

		updateSubagentProgressById('agent-2', {
			subagentName: 'research',
			status: 'running',
			toolCallCount: 1,
			turnCount: 1,
			tokenCount: 200,
		});

		const p1 = getSubagentProgress('agent-1');
		const p2 = getSubagentProgress('agent-2');

		// Agent 1 should have its own state
		t.is(p1.toolCallCount, 3);
		t.is(p1.tokenCount, 500);
		t.is(p1.currentTool, 'read_file');

		// Agent 2 should have its own state — no cross-contamination
		t.is(p2.toolCallCount, 1);
		t.is(p2.tokenCount, 200);
		t.is(p2.currentTool, undefined);
	},
);

test.serial(
	'getSubagentProgress returns legacy singleton for unknown agentId',
	t => {
		clearAllSubagentProgress();
		resetSubagentProgress();

		updateSubagentProgress({
			subagentName: 'legacy',
			status: 'running',
			toolCallCount: 7,
			turnCount: 3,
			tokenCount: 999,
		});

		// Unknown agent ID falls back to the legacy singleton
		const progress = getSubagentProgress('nonexistent');
		t.is(progress.subagentName, 'legacy');
		t.is(progress.toolCallCount, 7);
	},
);

test.serial('getAllSubagentProgress returns the map', t => {
	clearAllSubagentProgress();

	resetSubagentProgressById('a');
	resetSubagentProgressById('b');

	const all = getAllSubagentProgress();
	t.is(all.size, 2);
	t.true(all.has('a'));
	t.true(all.has('b'));
});

test.serial('removeSubagentProgress removes a single entry', t => {
	clearAllSubagentProgress();

	resetSubagentProgressById('a');
	resetSubagentProgressById('b');

	removeSubagentProgress('a');

	const all = getAllSubagentProgress();
	t.is(all.size, 1);
	t.false(all.has('a'));
	t.true(all.has('b'));
});

test.serial('clearAllSubagentProgress clears the map', t => {
	resetSubagentProgressById('x');
	resetSubagentProgressById('y');

	clearAllSubagentProgress();

	const all = getAllSubagentProgress();
	t.is(all.size, 0);
});
