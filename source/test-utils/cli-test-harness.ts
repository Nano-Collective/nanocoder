import {type ChildProcess, type SpawnOptions, spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CLITestResult {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	duration: number;
	killed: boolean;
}

export interface CLITestOptions {
	args?: string[];
	env?: Record<string, string>;
	timeout?: number;
	cwd?: string;
	stdin?: string;
	inheritEnv?: boolean;
	sendSignal?: {
		signal: NodeJS.Signals;
		delayMs: number;
	};
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

export function needsTsx(cliPath: string): boolean {
	return cliPath.endsWith('.tsx') || cliPath.endsWith('.ts');
}

export class CLITestHarness extends EventEmitter {
	private process: ChildProcess | null = null;
	private startTime: number = 0;
	private result: CLITestResult | null = null;
	private stdoutChunks: Buffer[] = [];
	private stderrChunks: Buffer[] = [];
	private timeoutId: NodeJS.Timeout | null = null;
	private signalTimeoutId: NodeJS.Timeout | null = null;

	async run(options: CLITestOptions = {}): Promise<CLITestResult> {
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
			...(opts.inheritEnv ? process.env : {}),
			...opts.env,
			NODE_ENV: 'test',
			FORCE_COLOR: '0',
			NO_COLOR: '1',
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

			try {
				this.process = spawn(command, args, spawnOptions);
			} catch (error) {
				reject(new Error(`Failed to spawn process: ${error}`));
				return;
			}

			if (opts.timeout && opts.timeout > 0) {
				this.timeoutId = setTimeout(() => {
					if (this.process && !this.process.killed) {
						this.process.kill('SIGKILL');
						this.result = this.buildResult(null, null, true);
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
				this.process.stdout.on('data', (chunk: Buffer) => {
					this.stdoutChunks.push(chunk);
					this.emit('stdout', chunk.toString());
				});
			}

			if (this.process.stderr) {
				this.process.stderr.on('data', (chunk: Buffer) => {
					this.stderrChunks.push(chunk);
					this.emit('stderr', chunk.toString());
				});
			}

			this.process.on('exit', (code, signal) => {
				this.cleanup();
				this.result = this.buildResult(code, signal, false);
				this.emit('exit', this.result);
				resolve(this.result);
			});

			this.process.on('error', error => {
				this.cleanup();
				reject(error);
			});
		});
	}

	sendSignal(signal: NodeJS.Signals): boolean {
		if (this.process && !this.process.killed) {
			return this.process.kill(signal);
		}
		return false;
	}

	writeToStdin(data: string): boolean {
		if (this.process?.stdin && !this.process.stdin.destroyed) {
			this.process.stdin.write(data);
			return true;
		}
		return false;
	}

	closeStdin(): boolean {
		if (this.process?.stdin && !this.process.stdin.destroyed) {
			this.process.stdin.end();
			return true;
		}
		return false;
	}

	kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
		if (this.process && !this.process.killed) {
			return this.process.kill(signal);
		}
		return false;
	}

	isRunning(): boolean {
		return (
			this.process !== null &&
			!this.process.killed &&
			this.process.exitCode === null
		);
	}

	getCurrentStdout(): string {
		return Buffer.concat(this.stdoutChunks).toString();
	}

	getCurrentStderr(): string {
		return Buffer.concat(this.stderrChunks).toString();
	}

	async waitForOutput(
		pattern: RegExp | string,
		options: {timeout?: number; stream?: 'stdout' | 'stderr' | 'both'} = {},
	): Promise<string> {
		const {timeout = 10000, stream = 'both'} = options;
		const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

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
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
		if (this.signalTimeoutId) {
			clearTimeout(this.signalTimeoutId);
			this.signalTimeoutId = null;
		}
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

export function createCLITestHarness(): CLITestHarness {
	return new CLITestHarness();
}

export async function runCLI(
	args: string[],
	options: Omit<CLITestOptions, 'args'> = {},
): Promise<CLITestResult> {
	const harness = createCLITestHarness();
	return harness.run({...options, args});
}

export async function runNonInteractive(
	prompt: string,
	options: Omit<CLITestOptions, 'args'> = {},
): Promise<CLITestResult> {
	const harness = createCLITestHarness();
	return harness.run({...options, args: ['run', prompt]});
}

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

export function assertTimedOut(result: CLITestResult): void {
	if (!result.timedOut) {
		throw new Error(
			`Expected process to time out, but it exited with code ${result.exitCode}.\n` +
				`stdout: ${result.stdout}\n` +
				`stderr: ${result.stderr}`,
		);
	}
}

export function assertStdoutContains(
	result: CLITestResult,
	pattern: string | RegExp,
): void {
	const matches =
		typeof pattern === 'string'
			? result.stdout.includes(pattern)
			: pattern.test(result.stdout);

	if (!matches) {
		throw new Error(
			`Expected stdout to contain ${pattern}, but it was:\n${result.stdout}`,
		);
	}
}

export function assertStderrContains(
	result: CLITestResult,
	pattern: string | RegExp,
): void {
	const matches =
		typeof pattern === 'string'
			? result.stderr.includes(pattern)
			: pattern.test(result.stderr);

	if (!matches) {
		throw new Error(
			`Expected stderr to contain ${pattern}, but it was:\n${result.stderr}`,
		);
	}
}

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
