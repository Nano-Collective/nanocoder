import {type ChildProcess, type SpawnOptions, spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Result object returned after a CLI process completes execution.
 */
export interface CLITestResult {
	/** Exit code of the process, or null if terminated by signal */
	exitCode: number | null;
	/** Signal that terminated the process, or null if exited normally */
	signal: NodeJS.Signals | null;
	/** Captured stdout output */
	stdout: string;
	/** Captured stderr output */
	stderr: string;
	/** Whether the process was killed due to timeout */
	timedOut: boolean;
	/** Duration in milliseconds from start to exit */
	duration: number;
	/** Whether the process was killed (by timeout, signal, or kill()) */
	killed: boolean;
}

/**
 * Options for configuring CLI test execution.
 */
export interface CLITestOptions {
	/** Command-line arguments to pass to the CLI */
	args?: string[];
	/** Environment variables to set (can override defaults when placed after inheritEnv) */
	env?: Record<string, string>;
	/** Timeout in milliseconds before killing the process (default: 30000) */
	timeout?: number;
	/** Working directory for the process */
	cwd?: string;
	/** Data to write to stdin before closing it */
	stdin?: string;
	/** Whether to inherit parent process environment variables (default: true) */
	inheritEnv?: boolean;
	/** Send a signal to the process after a delay */
	sendSignal?: {
		signal: NodeJS.Signals;
		delayMs: number;
	};
	/** Additional arguments to pass to Node.js */
	nodeArgs?: string[];
}

const DEFAULT_OPTIONS: Required<Omit<CLITestOptions, 'stdin' | 'sendSignal'>> =
	{
		args: [],
		env: {},
		timeout: 30000,
		cwd: process.cwd(),
		inheritEnv: true,
		nodeArgs: [],
	};

/**
 * Gets the path to the CLI entry point.
 * Prefers the compiled dist/cli.js, falls back to source/cli.tsx.
 * @returns Absolute path to the CLI entry point
 * @throws Error if neither path exists
 */
export function getCLIPath(): string {
	const distPath = path.resolve(__dirname, '../../dist/cli.js');
	if (fs.existsSync(distPath)) {
		return distPath;
	}

	const sourcePath = path.resolve(__dirname, '../cli.tsx');
	if (fs.existsSync(sourcePath)) {
		return sourcePath;
	}

	throw new Error(
		'CLI entry point not found. Please build the project first with `pnpm build`.',
	);
}

/**
 * Checks if the CLI path requires tsx to execute (TypeScript source files).
 * @param cliPath - Path to the CLI file
 * @returns true if the file is .ts or .tsx
 */
export function needsTsx(cliPath: string): boolean {
	return cliPath.endsWith('.tsx') || cliPath.endsWith('.ts');
}

/**
 * A test harness for spawning and controlling CLI processes.
 * Extends EventEmitter and emits 'stdout', 'stderr', 'exit', and 'signal-sent' events.
 *
 * @example
 * ```typescript
 * const harness = createCLITestHarness();
 * const result = await harness.run({ args: ['run', 'hello world'] });
 * assertExitCode(result, 0);
 * ```
 */
export class CLITestHarness extends EventEmitter {
	private process: ChildProcess | null = null;
	private startTime: number = 0;
	private result: CLITestResult | null = null;
	private stdoutChunks: Buffer[] = [];
	private stderrChunks: Buffer[] = [];
	private timeoutId: NodeJS.Timeout | null = null;
	private signalTimeoutId: NodeJS.Timeout | null = null;
	private _timedOut: boolean = false;
	private stdoutListener: ((chunk: Buffer) => void) | null = null;
	private stderrListener: ((chunk: Buffer) => void) | null = null;

	/**
	 * Spawns the CLI process with the given options and waits for it to exit.
	 * @param options - Configuration options for the CLI execution
	 * @returns Promise that resolves with the test result
	 * @throws Error if called while a process is already running
	 */
	async run(options: CLITestOptions = {}): Promise<CLITestResult> {
		if (this.isRunning()) {
			throw new Error(
				'CLITestHarness: Cannot call run() while a process is already running. ' +
					'Create a new harness instance or wait for the current process to complete.',
			);
		}
		const opts = {...DEFAULT_OPTIONS, ...options};
		const cliPath = getCLIPath();

		let command: string;
		let args: string[];

		if (needsTsx(cliPath)) {
			command = 'npx';
			args = ['tsx', ...opts.nodeArgs, cliPath, ...opts.args];
		} else {
			command = 'node';
			args = [...opts.nodeArgs, cliPath, ...opts.args];
		}

		const env: NodeJS.ProcessEnv = {
			NODE_ENV: 'test',
			FORCE_COLOR: '0',
			NO_COLOR: '1',
			...(opts.inheritEnv ? process.env : {}),
			...opts.env,
		};

		const spawnOptions: SpawnOptions = {
			cwd: opts.cwd,
			env,
			stdio: ['pipe', 'pipe', 'pipe'],
		};

		return new Promise((resolve, reject) => {
			this.startTime = Date.now();
			this.stdoutChunks = [];
			this.stderrChunks = [];
			this._timedOut = false;

			try {
				this.process = spawn(command, args, spawnOptions);
			} catch (error) {
				reject(new Error(`Failed to spawn process: ${error}`));
				return;
			}

			if (opts.timeout && opts.timeout > 0) {
				this.timeoutId = setTimeout(() => {
					if (this.process && !this.process.killed) {
						this._timedOut = true;
						this.process.kill('SIGKILL');
					}
				}, opts.timeout);
			}

			if (opts.sendSignal) {
				const {signal, delayMs} = opts.sendSignal;
				this.signalTimeoutId = setTimeout(() => {
					if (this.process && !this.process.killed) {
						this.process.kill(signal);
						this.emit('signal-sent', signal);
					}
				}, delayMs);
			}

			if (opts.stdin !== undefined && this.process.stdin) {
				this.process.stdin.write(opts.stdin);
				this.process.stdin.end();
			} else if (this.process.stdin) {
				this.process.stdin.end();
			}

			if (this.process.stdout) {
				this.stdoutListener = (chunk: Buffer) => {
					this.stdoutChunks.push(chunk);
					this.emit('stdout', chunk.toString());
				};
				this.process.stdout.on('data', this.stdoutListener);
			}

			if (this.process.stderr) {
				this.stderrListener = (chunk: Buffer) => {
					this.stderrChunks.push(chunk);
					this.emit('stderr', chunk.toString());
				};
				this.process.stderr.on('data', this.stderrListener);
			}

			this.process.on('exit', (code, signal) => {
				this.cleanup();
				this.result = this.buildResult(code, signal, this._timedOut);
				this.emit('exit', this.result);
				resolve(this.result);
			});

			this.process.on('error', error => {
				this.cleanup();
				reject(error);
			});
		});
	}

	/**
	 * Sends a signal to the running process.
	 * @param signal - The signal to send (e.g., 'SIGINT', 'SIGTERM')
	 * @returns true if the signal was sent, false if no process is running
	 */
	sendSignal(signal: NodeJS.Signals): boolean {
		if (this.process && !this.process.killed) {
			return this.process.kill(signal);
		}
		return false;
	}

	/**
	 * Writes data to the process's stdin.
	 * @param data - The string data to write
	 * @returns true if data was written, false if no process or stdin is unavailable
	 */
	writeToStdin(data: string): boolean {
		if (this.process?.stdin && !this.process.stdin.destroyed) {
			this.process.stdin.write(data);
			return true;
		}
		return false;
	}

	/**
	 * Closes the process's stdin stream.
	 * @returns true if stdin was closed, false if no process or stdin is unavailable
	 */
	closeStdin(): boolean {
		if (this.process?.stdin && !this.process.stdin.destroyed) {
			this.process.stdin.end();
			return true;
		}
		return false;
	}

	/**
	 * Kills the running process with the specified signal.
	 * @param signal - The signal to use (default: 'SIGTERM')
	 * @returns true if the process was killed, false if no process is running
	 */
	kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
		if (this.process && !this.process.killed) {
			return this.process.kill(signal);
		}
		return false;
	}

	/**
	 * Checks if a process is currently running.
	 * @returns true if a process is running and has not exited
	 */
	isRunning(): boolean {
		return (
			this.process !== null &&
			!this.process.killed &&
			this.process.exitCode === null
		);
	}

	/**
	 * Gets the current accumulated stdout output.
	 * @returns The stdout output collected so far
	 */
	getCurrentStdout(): string {
		const length = this.stdoutChunks.length;
		if (length === 0) {
			return '';
		}
		if (length === 1) {
			return this.stdoutChunks[0].toString();
		}
		return Buffer.concat(this.stdoutChunks).toString();
	}

	getCurrentStderr(): string {
		const length = this.stderrChunks.length;
		if (length === 0) {
			return '';
		}
		if (length === 1) {
			return this.stderrChunks[0].toString();
		}
		if (this.stderrChunks.length === 0) return '';
		if (this.stderrChunks.length === 1) return this.stderrChunks[0].toString();
		return Buffer.concat(this.stderrChunks).toString();
	}

	/**
	 * Waits for output matching a pattern to appear in the process output.
	 * @param pattern - String or RegExp to match against output
	 * @param options - Options for timeout and which stream(s) to check
	 * @returns Promise that resolves with the matched string
	 * @throws Error if timeout is reached before pattern is found
	 */
	async waitForOutput(
		pattern: RegExp | string,
		options: {timeout?: number; stream?: 'stdout' | 'stderr' | 'both'} = {},
	): Promise<string> {
		const {timeout = 10000, stream = 'both'} = options;
		// Pattern is provided by test code, not user input - ReDoS is not a concern here
		const regex =
			typeof pattern === 'string'
				? new RegExp(pattern) /* nosemgrep */
				: pattern;

		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(new Error(`Timed out waiting for output matching: ${pattern}`));
			}, timeout);

			const checkOutput = () => {
				const stdoutText = this.getCurrentStdout();
				const stderrText = this.getCurrentStderr();

				let textToCheck = '';
				if (stream === 'stdout') {
					textToCheck = stdoutText;
				} else if (stream === 'stderr') {
					textToCheck = stderrText;
				} else {
					textToCheck = stdoutText + stderrText;
				}

				const match = regex.exec(textToCheck);
				if (match) {
					clearTimeout(timeoutId);
					resolve(match[0]);
				}
			};

			checkOutput();

			const onStdout = () => {
				if (stream === 'stdout' || stream === 'both') checkOutput();
			};
			const onStderr = () => {
				if (stream === 'stderr' || stream === 'both') checkOutput();
			};

			this.on('stdout', onStdout);
			this.on('stderr', onStderr);

			setTimeout(() => {
				this.off('stdout', onStdout);
				this.off('stderr', onStderr);
			}, timeout + 100);
		});
	}

	private cleanup(): void {
		if (this.process?.stdout && this.stdoutListener) {
			this.process.stdout.off('data', this.stdoutListener);
			this.stdoutListener = null;
		}
		if (this.process?.stderr && this.stderrListener) {
			this.process.stderr.off('data', this.stderrListener);
			this.stderrListener = null;
		}
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
		if (this.signalTimeoutId) {
			clearTimeout(this.signalTimeoutId);
			this.signalTimeoutId = null;
		}
		this.process = null;
	}

	private buildResult(
		exitCode: number | null,
		signal: NodeJS.Signals | null,
		timedOut: boolean,
	): CLITestResult {
		return {
			exitCode,
			signal,
			stdout: Buffer.concat(this.stdoutChunks).toString(),
			stderr: Buffer.concat(this.stderrChunks).toString(),
			timedOut,
			duration: Date.now() - this.startTime,
			killed: this.process?.killed ?? false,
		};
	}
}

/**
 * Creates a new CLITestHarness instance.
 * @returns A new CLITestHarness ready to run tests
 */
export function createCLITestHarness(): CLITestHarness {
	return new CLITestHarness();
}

/**
 * Asserts that the process exited with the expected exit code.
 * @param result - The CLI test result to check
 * @param expectedCode - The expected exit code
 * @throws Error if the exit code doesn't match
 */
export function assertExitCode(
	result: CLITestResult,
	expectedCode: number,
): void {
	if (result.exitCode !== expectedCode) {
		throw new Error(
			`Expected exit code ${expectedCode}, but got ${result.exitCode}.\n` +
				`stdout: ${result.stdout}\n` +
				`stderr: ${result.stderr}`,
		);
	}
}

/**
 * Asserts that the process was terminated by the expected signal.
 * @param result - The CLI test result to check
 * @param expectedSignal - The expected termination signal
 * @throws Error if the signal doesn't match
 */
export function assertSignal(
	result: CLITestResult,
	expectedSignal: NodeJS.Signals,
): void {
	if (result.signal !== expectedSignal) {
		throw new Error(
			`Expected signal ${expectedSignal}, but got ${result.signal}.\n` +
				`stdout: ${result.stdout}\n` +
				`stderr: ${result.stderr}`,
		);
	}
}

/**
 * Asserts that the process timed out.
 * @param result - The CLI test result to check
 * @throws Error if the process did not time out
 */
export function assertTimedOut(result: CLITestResult): void {
	if (!result.timedOut) {
		throw new Error(
			`Expected process to time out, but it exited with code ${result.exitCode}.\n` +
				`stdout: ${result.stdout}\n` +
				`stderr: ${result.stderr}`,
		);
	}
}

/**
 * Asserts that stdout contains the expected pattern.
 * @param result - The CLI test result to check
 * @param pattern - String or RegExp to match against stdout
 * @throws Error if the pattern is not found in stdout
 */
export function assertStdoutContains(
	result: CLITestResult,
	pattern: string | RegExp,
): void {
	const matches =
		typeof pattern === 'string'
			? result.stdout.includes(pattern)
			: pattern.test(result.stdout);

	if (!matches) {
		const patternStr =
			typeof pattern === 'string' ? `"${pattern}"` : pattern.toString();
		throw new Error(
			`Expected stdout to contain ${patternStr}, but it was:\n${result.stdout}`,
		);
	}
}

/**
 * Asserts that stderr contains the expected pattern.
 * @param result - The CLI test result to check
 * @param pattern - String or RegExp to match against stderr
 * @throws Error if the pattern is not found in stderr
 */
export function assertStderrContains(
	result: CLITestResult,
	pattern: string | RegExp,
): void {
	const matches =
		typeof pattern === 'string'
			? result.stderr.includes(pattern)
			: pattern.test(result.stderr);

	if (!matches) {
		const patternStr =
			typeof pattern === 'string' ? `"${pattern}"` : pattern.toString();
		throw new Error(
			`Expected stderr to contain ${patternStr}, but it was:\n${result.stderr}`,
		);
	}
}

/**
 * Asserts that the process completed within the specified time.
 * @param result - The CLI test result to check
 * @param maxDurationMs - Maximum allowed duration in milliseconds
 * @throws Error if the process took longer than the specified time
 */
export function assertCompletedWithin(
	result: CLITestResult,
	maxDurationMs: number,
): void {
	if (result.duration > maxDurationMs) {
		throw new Error(
			`Expected process to complete within ${maxDurationMs}ms, ` +
				`but it took ${result.duration}ms.`,
		);
	}
}
