import test from 'ava';
import { BashExecutor } from './bash-executor';

console.log(`\nbash-executor.spec.ts`);

// Track executors for cleanup
const executorsToCleanup: BashExecutor[] = [];

// Helper to create a fresh executor for each test
function createExecutor(): BashExecutor {
	const executor = new BashExecutor();
	executorsToCleanup.push(executor);
	return executor;
}

// Clean up after each test to prevent event listeners from keeping Node alive
test.afterEach(() => {
	for (const executor of executorsToCleanup) {
		// Cancel any active executions
		for (const id of executor.getActiveExecutionIds()) {
			executor.cancel(id);
		}
		// Remove all event listeners to allow Node to exit
		executor.removeAllListeners();
	}
	executorsToCleanup.length = 0;
});

// Basic execution tests
test('execute - returns executionId and promise', async t => {
	const executor = createExecutor();
	const { executionId, promise } = executor.execute('echo hello');

	t.is(typeof executionId, 'string');
	t.true(executionId.length > 0);
	t.true(promise instanceof Promise);

	// Clean up - wait for process to terminate
	executor.cancel(executionId);
	await promise;
});

test('execute - generates unique execution IDs', async t => {
	const executor = createExecutor();
	const result1 = executor.execute('echo 1');
	const result2 = executor.execute('echo 2');

	t.not(result1.executionId, result2.executionId);

	// Clean up - wait for processes to terminate
	executor.cancel(result1.executionId);
	executor.cancel(result2.executionId);
	await Promise.all([result1.promise, result2.promise]);
});

test('execute - captures stdout output', async t => {
	const executor = createExecutor();
	const { promise } = executor.execute('echo "test output"');
	const result = await promise;

	t.true(result.fullOutput.includes('test output'));
	t.is(result.exitCode, 0);
	t.true(result.isComplete);
	t.is(result.error, null);
});

test('execute - captures stderr output', async t => {
	const executor = createExecutor();
	const { promise } = executor.execute('echo "error message" >&2');
	const result = await promise;

	t.true(result.stderr.includes('error message'));
	t.is(result.exitCode, 0);
	t.true(result.isComplete);
});

test('execute - captures exit code for successful command', async t => {
	const executor = createExecutor();
	const { promise } = executor.execute('exit 0');
	const result = await promise;

	t.is(result.exitCode, 0);
	t.true(result.isComplete);
});

test('execute - captures exit code for failed command', async t => {
	const executor = createExecutor();
	const { promise } = executor.execute('exit 42');
	const result = await promise;

	t.is(result.exitCode, 42);
	t.true(result.isComplete);
});

test('execute - stores command in result state', async t => {
	const executor = createExecutor();
	const command = 'echo "my command"';
	const { promise } = executor.execute(command);
	const result = await promise;

	t.is(result.command, command);
});

test('execute - creates output preview from last 150 chars', async t => {
	const executor = createExecutor();
	// Generate output longer than 150 chars using a portable command
	const { promise } = executor.execute('seq 200 | xargs -I {} printf "-"');
	const result = await promise;

	t.true(result.fullOutput.length >= 150);
	t.is(result.outputPreview.length, 150);
	t.is(result.outputPreview, result.fullOutput.slice(-150));
});

// Event emission tests
test('execute - emits start event', async t => {
	const executor = createExecutor();
	let startEventReceived = false;
	let startState: unknown = null;

	executor.on('start', state => {
		startEventReceived = true;
		startState = state;
	});

	const { executionId, promise } = executor.execute('echo test');

	// Start event should be emitted synchronously
	t.true(startEventReceived);
	t.truthy(startState);
	t.is((startState as { executionId: string }).executionId, executionId);

	await promise;
});

test('execute - emits complete event when done', async t => {
	const executor = createExecutor();
	let completeEventReceived = false;
	let completeState: unknown = null;

	executor.on('complete', state => {
		completeEventReceived = true;
		completeState = state;
	});

	const { executionId, promise } = executor.execute('echo test');
	await promise;

	t.true(completeEventReceived);
	t.truthy(completeState);
	t.is((completeState as { executionId: string }).executionId, executionId);
	t.true((completeState as { isComplete: boolean }).isComplete);
});

// Cancel tests
test('cancel - returns true for active execution', async t => {
	const executor = createExecutor();
	const { executionId, promise } = executor.execute('sleep 10');

	const cancelled = executor.cancel(executionId);

	t.true(cancelled);

	// Wait for the process to fully terminate
	await promise;
});

test('cancel - returns false for unknown execution ID', t => {
	const executor = createExecutor();

	const cancelled = executor.cancel('non-existent-id');

	t.false(cancelled);
});

test('cancel - resolves the promise with cancelled state', async t => {
	const executor = createExecutor();
	const { executionId, promise } = executor.execute('sleep 10');

	executor.cancel(executionId);
	const result = await promise;

	t.true(result.isComplete);
	t.is(result.error, 'Cancelled by user');
});

test('cancel - emits complete event with error', async t => {
	const executor = createExecutor();
	let completeState: unknown = null;

	executor.on('complete', state => {
		completeState = state;
	});

	const { executionId, promise } = executor.execute('sleep 10');
	executor.cancel(executionId);
	await promise;

	t.truthy(completeState);
	t.is((completeState as { error: string }).error, 'Cancelled by user');
});

test('cancel - removes execution from active list', async t => {
	const executor = createExecutor();
	const { executionId, promise } = executor.execute('sleep 10');

	t.true(executor.hasActiveExecutions());
	executor.cancel(executionId);
	t.false(executor.hasActiveExecutions());

	// Wait for the process to fully terminate
	await promise;
});

// getState tests
test('getState - returns state for active execution', async t => {
	const executor = createExecutor();
	const { executionId, promise } = executor.execute('sleep 10');

	const state = executor.getState(executionId);

	t.truthy(state);
	t.is(state?.executionId, executionId);
	t.false(state?.isComplete);

	// Clean up - wait for process to terminate
	executor.cancel(executionId);
	await promise;
});

test('getState - returns undefined for unknown execution ID', t => {
	const executor = createExecutor();

	const state = executor.getState('non-existent-id');

	t.is(state, undefined);
});

test('getState - returns copy of state (immutable)', async t => {
	const executor = createExecutor();
	const { executionId, promise } = executor.execute('sleep 10');

	const state1 = executor.getState(executionId);
	const state2 = executor.getState(executionId);

	t.not(state1, state2); // Different object references
	t.deepEqual(state1, state2); // Same content

	// Clean up - wait for process to terminate
	executor.cancel(executionId);
	await promise;
});

// hasActiveExecutions tests
test('hasActiveExecutions - returns false when no executions', t => {
	const executor = createExecutor();

	t.false(executor.hasActiveExecutions());
});

test('hasActiveExecutions - returns true when executions active', async t => {
	const executor = createExecutor();
	const { executionId, promise } = executor.execute('sleep 10');

	t.true(executor.hasActiveExecutions());

	// Clean up - wait for process to terminate
	executor.cancel(executionId);
	await promise;
});

test('hasActiveExecutions - returns false after execution completes', async t => {
	const executor = createExecutor();
	const { promise } = executor.execute('echo fast');

	await promise;

	t.false(executor.hasActiveExecutions());
});

// getActiveExecutionIds tests
test('getActiveExecutionIds - returns empty array when no executions', t => {
	const executor = createExecutor();

	const ids = executor.getActiveExecutionIds();

	t.deepEqual(ids, []);
});

test('getActiveExecutionIds - returns all active execution IDs', async t => {
	const executor = createExecutor();
	const exec1 = executor.execute('sleep 10');
	const exec2 = executor.execute('sleep 10');

	const ids = executor.getActiveExecutionIds();

	t.is(ids.length, 2);
	t.true(ids.includes(exec1.executionId));
	t.true(ids.includes(exec2.executionId));

	// Clean up - wait for processes to terminate
	executor.cancel(exec1.executionId);
	executor.cancel(exec2.executionId);
	await Promise.all([exec1.promise, exec2.promise]);
});

test('getActiveExecutionIds - excludes completed executions', async t => {
	const executor = createExecutor();
	const exec1 = executor.execute('echo fast');
	const exec2 = executor.execute('sleep 10');

	await exec1.promise;

	const ids = executor.getActiveExecutionIds();

	t.is(ids.length, 1);
	t.false(ids.includes(exec1.executionId));
	t.true(ids.includes(exec2.executionId));

	// Clean up - wait for process to terminate
	executor.cancel(exec2.executionId);
	await exec2.promise;
});

// Multiple executions
test('execute - supports multiple concurrent executions', async t => {
	const executor = createExecutor();

	const exec1 = executor.execute('echo first');
	const exec2 = executor.execute('echo second');
	const exec3 = executor.execute('echo third');

	const [result1, result2, result3] = await Promise.all([
		exec1.promise,
		exec2.promise,
		exec3.promise,
	]);

	t.true(result1.fullOutput.includes('first'));
	t.true(result2.fullOutput.includes('second'));
	t.true(result3.fullOutput.includes('third'));
});

// Edge cases
test('execute - handles empty command output', async t => {
	const executor = createExecutor();
	const { promise } = executor.execute('true');
	const result = await promise;

	t.is(result.fullOutput, '');
	t.is(result.exitCode, 0);
});

test('execute - handles command with special characters', async t => {
	const executor = createExecutor();
	const { promise } = executor.execute('echo "hello $USER"');
	const result = await promise;

	t.true(result.fullOutput.length > 0);
	t.is(result.exitCode, 0);
});

test('execute - handles multiline output', async t => {
	const executor = createExecutor();
	const { promise } = executor.execute('echo "line1"; echo "line2"; echo "line3"');
	const result = await promise;

	t.true(result.fullOutput.includes('line1'));
	t.true(result.fullOutput.includes('line2'));
	t.true(result.fullOutput.includes('line3'));
});

// State immutability from complete event
test('complete event - provides immutable state copy', async t => {
	const executor = createExecutor();
	let eventState: unknown = null;

	executor.on('complete', state => {
		eventState = state;
	});

	const { promise } = executor.execute('echo test');
	const promiseResult = await promise;

	// Both should have same content
	t.deepEqual(eventState, promiseResult);

	// But be different objects
	t.not(eventState, promiseResult);
});

test('timeout resolves with the timeout error after timeoutMs', async t => {
	const executor = createExecutor();
	const start = Date.now();

	// Pass a very short timeout
	const { promise } = executor.execute('sleep 10', { timeoutMs: 100 });
	const result = await promise;

	const elapsed = Date.now() - start;

	t.true(result.isComplete, 'Command should be marked complete');
	t.is(result.error, 'Command timed out after 100ms', 'Should have the specific timeout error');
	t.true(elapsed < 1000, `Command ran ${elapsed}ms — it was successfully killed early by the timeout`);
});

test('signal abort resolves with the cancel error', async t => {
	const executor = createExecutor();
	const controller = new AbortController();
	controller.abort(); // signal already aborted before execute() is called

	const start = Date.now();
	const { promise } = executor.execute('sleep 10', { signal: controller.signal });
	const result = await promise;
	const elapsed = Date.now() - start;

	t.true(
		elapsed < 500,
		`Command aborted immediately (${elapsed}ms) instead of hanging`,
	);
	t.is(result.error, 'Cancelled via AbortSignal', 'Has correct abort error');
	t.true(result.isComplete, 'Command should be marked complete');
});

test('output cap trips and appends the truncation marker exactly once', async t => {
	// Dynamically import the limit so we test against the actual cap
	const { BASH_MAX_OUTPUT_BYTES } = await import('../constants.js');
	const executor = createExecutor();

	// We'll write more than BASH_MAX_OUTPUT_BYTES using python to avoid
	// large bash allocations. This will emit slightly over the limit.
	const { promise } = executor.execute(`python3 -c "print('A' * (${BASH_MAX_OUTPUT_BYTES} + 1000))"`);
	const result = await promise;

	const truncationMarker = '... [Output truncated to prevent memory exhaustion]';

	t.true(
		result.fullOutput.includes(truncationMarker),
		'The output should have the truncation message appended',
	);

	// Ensure it only appears exactly once
	const matches = result.fullOutput.split(truncationMarker).length - 1;
	t.is(matches, 1, 'The truncation marker should be appended exactly once');

	t.true(
		result.fullOutput.length < BASH_MAX_OUTPUT_BYTES + 10000,
		`fullOutput length ${result.fullOutput.length} is capped properly`,
	);
});

test('cancel() on a detached process kills a spawned child (process-group assertion)', async t => {
	const executor = createExecutor();
	const { promise, executionId } = executor.execute('node -e "setInterval(() => {}, 1000)" & echo $!');

	// Wait briefly for the output to appear
	await new Promise(resolve => setTimeout(resolve, 300));

	const state = executor.getState(executionId);
	t.truthy(state, 'Execution should be active');

	const match = state?.fullOutput.match(/(\d+)/);
	t.truthy(match, 'Should have captured the background child PID');
	const childPid = parseInt(match![1]!, 10);

	// Verify child is alive
	try {
		process.kill(childPid, 0);
		t.pass('Child is alive before cancel');
	} catch {
		t.fail('Child should be alive before cancel');
	}

	// Cancel the execution tree
	executor.cancel(executionId);
	await promise;

	// Give the OS a moment to reap the process
	await new Promise(resolve => setTimeout(resolve, 300));

	// Verify child is dead
	t.throws(() => {
		process.kill(childPid, 0);
	}, undefined, 'process.kill(pid, 0) should throw because the child was killed by the process-group signal');
});
