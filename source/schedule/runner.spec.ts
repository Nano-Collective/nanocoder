import test from 'ava';
import {ScheduleRunner} from './runner';
import type {ScheduleRunnerCallbacks} from './runner';

// ============================================================================
// Helpers
// ============================================================================

function createMockCallbacks(
	overrides?: Partial<ScheduleRunnerCallbacks>,
): ScheduleRunnerCallbacks {
	return {
		handleMessageSubmit: async () => {},
		clearMessages: async () => {},
		onJobStart: () => {},
		onJobComplete: () => {},
		onJobError: () => {},
		waitForConversationComplete: async () => {},
		...overrides,
	};
}

// ============================================================================
// Constructor & Initial State Tests
// ============================================================================

test('ScheduleRunner initializes with zero active jobs', t => {
	const runner = new ScheduleRunner(createMockCallbacks());
	t.is(runner.getActiveJobCount(), 0);
});

test('ScheduleRunner initializes with empty queue', t => {
	const runner = new ScheduleRunner(createMockCallbacks());
	t.is(runner.getQueueLength(), 0);
});

test('ScheduleRunner initializes as not processing', t => {
	const runner = new ScheduleRunner(createMockCallbacks());
	t.is(runner.getIsProcessing(), false);
});

// ============================================================================
// Stop Tests
// ============================================================================

test('stop clears all state', t => {
	const runner = new ScheduleRunner(createMockCallbacks());
	runner.stop();
	t.is(runner.getActiveJobCount(), 0);
	t.is(runner.getQueueLength(), 0);
	t.is(runner.getIsProcessing(), false);
});

test('stop can be called multiple times without error', t => {
	const runner = new ScheduleRunner(createMockCallbacks());
	t.notThrows(() => {
		runner.stop();
		runner.stop();
		runner.stop();
	});
});

// ============================================================================
// Start Tests
// ============================================================================

test.serial('start does nothing when called twice', async t => {
	const runner = new ScheduleRunner(createMockCallbacks());
	// First start (will try to load schedules from disk, which may fail — that's OK)
	await runner.start();
	// Second start should be a no-op (guard check)
	await runner.start();
	// Just verify it doesn't throw
	t.pass();
	runner.stop();
});
