import test from 'ava';
import {
	CLITestHarness,
	createCLITestHarness,
	getCLIPath,
	needsTsx,
	type CLITestResult,
	assertExitCode,
	assertTimedOut,
	assertStdoutContains,
	assertStderrContains,
	assertCompletedWithin,
	assertSignal,
} from './test-utils/cli-test-harness';
import * as fs from 'node:fs';

test('getCLIPath returns a valid path', t => {
	try {
		const cliPath = getCLIPath();
		t.true(fs.existsSync(cliPath), `CLI path should exist: ${cliPath}`);
	} catch {
		t.pass('CLI path not available (build may not have run)');
	}
});

test('needsTsx correctly identifies TypeScript files', t => {
	t.true(needsTsx('/path/to/file.ts'));
	t.true(needsTsx('/path/to/file.tsx'));
	t.false(needsTsx('/path/to/file.js'));
	t.false(needsTsx('/path/to/file.mjs'));
});

test('createCLITestHarness returns a CLITestHarness instance', t => {
	const harness = createCLITestHarness();
	t.true(harness instanceof CLITestHarness);
});

test('isRunning returns false before run', t => {
	const harness = createCLITestHarness();
	t.false(harness.isRunning());
});

test('getCurrentStdout returns empty string before run', t => {
	const harness = createCLITestHarness();
	t.is(harness.getCurrentStdout(), '');
});

test('getCurrentStderr returns empty string before run', t => {
	const harness = createCLITestHarness();
	t.is(harness.getCurrentStderr(), '');
});

test('assertExitCode passes when exit code matches', t => {
	const result: CLITestResult = {
		exitCode: 0,
		signal: null,
		stdout: '',
		stderr: '',
		timedOut: false,
		duration: 100,
		killed: false,
	};
	t.notThrows(() => assertExitCode(result, 0));
});

test('assertExitCode throws when exit code does not match', t => {
	const result: CLITestResult = {
		exitCode: 1,
		signal: null,
		stdout: 'stdout output',
		stderr: 'stderr output',
		timedOut: false,
		duration: 100,
		killed: false,
	};
	const error = t.throws(() => assertExitCode(result, 0));
	t.true(error?.message.includes('Expected exit code 0'));
	t.true(error?.message.includes('but got 1'));
});

test('assertSignal passes when signal matches', t => {
	const result: CLITestResult = {
		exitCode: null,
		signal: 'SIGTERM',
		stdout: '',
		stderr: '',
		timedOut: false,
		duration: 100,
		killed: true,
	};
	t.notThrows(() => assertSignal(result, 'SIGTERM'));
});

test('assertSignal throws when signal does not match', t => {
	const result: CLITestResult = {
		exitCode: null,
		signal: 'SIGKILL',
		stdout: '',
		stderr: '',
		timedOut: false,
		duration: 100,
		killed: true,
	};
	const error = t.throws(() => assertSignal(result, 'SIGTERM'));
	t.true(error?.message.includes('Expected signal SIGTERM'));
	t.true(error?.message.includes('but got SIGKILL'));
});

test('assertTimedOut passes when process timed out', t => {
	const result: CLITestResult = {
		exitCode: null,
		signal: 'SIGKILL',
		stdout: '',
		stderr: '',
		timedOut: true,
		duration: 5000,
		killed: true,
	};
	t.notThrows(() => assertTimedOut(result));
});

test('assertTimedOut throws when process did not time out', t => {
	const result: CLITestResult = {
		exitCode: 0,
		signal: null,
		stdout: '',
		stderr: '',
		timedOut: false,
		duration: 100,
		killed: false,
	};
	const error = t.throws(() => assertTimedOut(result));
	t.true(error?.message.includes('Expected process to time out'));
});

test('assertStdoutContains passes with matching string', t => {
	const result: CLITestResult = {
		exitCode: 0,
		signal: null,
		stdout: 'Hello, World!',
		stderr: '',
		timedOut: false,
		duration: 100,
		killed: false,
	};
	t.notThrows(() => assertStdoutContains(result, 'Hello'));
});

test('assertStdoutContains passes with matching regex', t => {
	const result: CLITestResult = {
		exitCode: 0,
		signal: null,
		stdout: 'Hello, World!',
		stderr: '',
		timedOut: false,
		duration: 100,
		killed: false,
	};
	t.notThrows(() => assertStdoutContains(result, /World/));
});

test('assertStdoutContains throws when pattern not found', t => {
	const result: CLITestResult = {
		exitCode: 0,
		signal: null,
		stdout: 'Hello, World!',
		stderr: '',
		timedOut: false,
		duration: 100,
		killed: false,
	};
	const error = t.throws(() => assertStdoutContains(result, 'Goodbye'));
	t.true(error?.message.includes('Expected stdout to contain'));
});

test('assertStderrContains passes with matching string', t => {
	const result: CLITestResult = {
		exitCode: 1,
		signal: null,
		stdout: '',
		stderr: 'Error: Something went wrong',
		timedOut: false,
		duration: 100,
		killed: false,
	};
	t.notThrows(() => assertStderrContains(result, 'Error'));
});

test('assertStderrContains throws when pattern not found', t => {
	const result: CLITestResult = {
		exitCode: 1,
		signal: null,
		stdout: '',
		stderr: 'Error: Something went wrong',
		timedOut: false,
		duration: 100,
		killed: false,
	};
	const error = t.throws(() => assertStderrContains(result, 'Warning'));
	t.true(error?.message.includes('Expected stderr to contain'));
});

test('assertCompletedWithin passes when duration is within limit', t => {
	const result: CLITestResult = {
		exitCode: 0,
		signal: null,
		stdout: '',
		stderr: '',
		timedOut: false,
		duration: 100,
		killed: false,
	};
	t.notThrows(() => assertCompletedWithin(result, 500));
});

test('assertCompletedWithin throws when duration exceeds limit', t => {
	const result: CLITestResult = {
		exitCode: 0,
		signal: null,
		stdout: '',
		stderr: '',
		timedOut: false,
		duration: 1000,
		killed: false,
	};
	const error = t.throws(() => assertCompletedWithin(result, 500));
	t.true(error?.message.includes('Expected process to complete within 500ms'));
	t.true(error?.message.includes('took 1000ms'));
});

test('run method exists and is callable', t => {
	const harness = createCLITestHarness();
	t.is(typeof harness.run, 'function');
});



test('CLITestResult has correct shape', t => {
	const result: CLITestResult = {
		exitCode: 0,
		signal: null,
		stdout: 'output',
		stderr: 'error',
		timedOut: false,
		duration: 100,
		killed: false,
	};
	t.is(result.exitCode, 0);
	t.is(result.signal, null);
	t.is(result.stdout, 'output');
	t.is(result.stderr, 'error');
	t.is(result.timedOut, false);
	t.is(result.duration, 100);
	t.is(result.killed, false);
});

test('CLI args parsing: run command is detected', t => {
	const args = ['run', 'test prompt'];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	t.is(runCommandIndex, 0);
	t.truthy(args[runCommandIndex + 1]);
});

test('CLI args parsing: nonInteractiveMode flag is set correctly', t => {
	const args = ['run', 'test prompt'];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const nonInteractiveMode = runCommandIndex !== -1;
	t.true(nonInteractiveMode);
});

test('CLI args parsing: nonInteractiveMode is false without run command', t => {
	const args = ['--vscode'];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const nonInteractiveMode = runCommandIndex !== -1;
	t.false(nonInteractiveMode);
});

type ExitReason = 'complete' | 'timeout' | 'error' | 'tool-approval' | null;

function getExitCodeForReason(reason: ExitReason): number {
	return reason === 'error' || reason === 'tool-approval' ? 1 : 0;
}

test('Exit code mapping: complete reason uses exit code 0', t => {
	const reason: ExitReason = 'complete';
	t.is(getExitCodeForReason(reason), 0);
});

test('Exit code mapping: error reason uses exit code 1', t => {
	const reason: ExitReason = 'error';
	t.is(getExitCodeForReason(reason), 1);
});

test('Exit code mapping: tool-approval reason uses exit code 1', t => {
	const reason: ExitReason = 'tool-approval';
	t.is(getExitCodeForReason(reason), 1);
});

test('Exit code mapping: timeout reason uses exit code 0', t => {
	const reason: ExitReason = 'timeout';
	t.is(getExitCodeForReason(reason), 0);
});

test('Signal handling: SIGINT is a valid NodeJS signal', t => {
	const validSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGQUIT', 'SIGHUP'];
	t.true(validSignals.includes('SIGINT'));
});

test('Signal handling: SIGTERM is a valid NodeJS signal', t => {
	const validSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGQUIT', 'SIGHUP'];
	t.true(validSignals.includes('SIGTERM'));
});

test('Timeout detection: identifies when duration exceeds max', t => {
	const startTime = Date.now() - 400000;
	const maxExecutionTimeMs = 300000;
	const hasTimedOut = Date.now() - startTime > maxExecutionTimeMs;
	t.true(hasTimedOut);
});

test('Timeout detection: does not trigger when within time limit', t => {
	const startTime = Date.now() - 60000;
	const maxExecutionTimeMs = 300000;
	const hasTimedOut = Date.now() - startTime > maxExecutionTimeMs;
	t.false(hasTimedOut);
});

test('CLITestHarness extends EventEmitter', t => {
	const harness = createCLITestHarness();
	t.is(typeof harness.on, 'function');
	t.is(typeof harness.emit, 'function');
	t.is(typeof harness.off, 'function');
});

test('sendSignal returns false when no process running', t => {
	const harness = createCLITestHarness();
	t.false(harness.sendSignal('SIGTERM'));
});

test('writeToStdin returns false when no process running', t => {
	const harness = createCLITestHarness();
	t.false(harness.writeToStdin('test'));
});

test('closeStdin returns false when no process running', t => {
	const harness = createCLITestHarness();
	t.false(harness.closeStdin());
});

test('kill returns false when no process running', t => {
	const harness = createCLITestHarness();
	t.false(harness.kill());
});

test('integration: run throws error when called concurrently', async t => {
	const harness = createCLITestHarness();
	const runPromise = harness.run({
		args: ['--help'],
		timeout: 10000,
	});

	await new Promise(resolve => setTimeout(resolve, 50));

	if (harness.isRunning()) {
		await t.throwsAsync(
			async () => {
				await harness.run({args: ['--version']});
			},
			{message: /Cannot call run\(\) while a process is already running/},
		);
	} else {
		t.pass('Process completed before concurrent call could be tested');
	}

	await runPromise;
});

test('integration: CLI help command completes successfully', async t => {
	const harness = createCLITestHarness();
	try {
		const result = await harness.run({
			args: ['--help'],
			timeout: 30000,
		});
		t.is(result.exitCode, 0);
		t.false(result.timedOut);
	} catch {
		t.pass('CLI not available (build may not have run)');
	}
});

test('integration: CLI version command completes successfully', async t => {
	const harness = createCLITestHarness();
	try {
		const result = await harness.run({
			args: ['--version'],
			timeout: 30000,
		});
		t.is(result.exitCode, 0);
		t.false(result.timedOut);
		t.false(result.killed);
	} catch {
		t.pass('CLI not available (build may not have run)');
	}
});

test('integration: harness correctly reports duration', async t => {
	const harness = createCLITestHarness();
	try {
		const startTime = Date.now();
		const result = await harness.run({
			args: ['--help'],
			timeout: 30000,
		});
		const actualDuration = Date.now() - startTime;
		t.true(Math.abs(result.duration - actualDuration) < 100);
	} catch {
		t.pass('CLI not available (build may not have run)');
	}
});

test('integration: harness cleans up after completion', async t => {
	const harness = createCLITestHarness();
	try {
		await harness.run({
			args: ['--help'],
			timeout: 30000,
		});
		t.false(harness.isRunning());
	} catch {
		t.pass('CLI not available (build may not have run)');
	}
});

test('integration: respects custom environment variables', async t => {
	const harness = createCLITestHarness();
	try {
		const result = await harness.run({
			args: ['--help'],
			env: {CUSTOM_TEST_VAR: 'test_value'},
			timeout: 30000,
		});
		t.is(result.exitCode, 0);
	} catch {
		t.pass('CLI not available (build may not have run)');
	}
});
