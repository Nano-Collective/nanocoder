import {type ChildProcess, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {platform} from 'node:process';

import {
	BASH_OUTPUT_PREVIEW_LENGTH,
	INTERVAL_BASH_PROGRESS_MS,
} from '@/constants';

const isWindows = platform === 'win32';

export interface BashExecutionState {
	executionId: string;
	command: string;
	outputPreview: string; // Last 150 chars for display
	fullOutput: string; // Complete output
	stderr: string; // Complete stderr
	isComplete: boolean;
	exitCode: number | null;
	error: string | null;
}

interface ExecutionEntry {
	state: BashExecutionState;
	process: ChildProcess;
	intervalId: NodeJS.Timeout;
	resolve: (state: BashExecutionState) => void;
}

export class BashExecutor extends EventEmitter {
	private executions = new Map<string, ExecutionEntry>();

	execute(command: string): {
		executionId: string;
		promise: Promise<BashExecutionState>;
	} {
		const executionId = randomUUID();

		const state: BashExecutionState = {
			executionId,
			command,
			outputPreview: '',
			fullOutput: '',
			stderr: '',
			isComplete: false,
			exitCode: null,
			error: null,
		};

		const proc = isWindows
			? spawn('cmd', ['/c', command])
			: // `detached` makes the child a process-group leader so cancel() can
				// signal the whole tree (e.g. `pnpm test` -> node -> test runner),
				// not just the `sh` wrapper. Without it a cancelled command's
				// children keep running in the background.
				spawn('sh', ['-c', command], {detached: true});

		// Collect output
		proc.stdout.on('data', (data: Buffer) => {
			state.fullOutput += data.toString();
			state.outputPreview = state.fullOutput.slice(-BASH_OUTPUT_PREVIEW_LENGTH);
			// Emit progress immediately when output is received
			// This ensures fast commands still show streaming output
			this.emit('progress', {...state});
		});

		proc.stderr.on('data', (data: Buffer) => {
			state.stderr += data.toString();
			// Emit progress immediately when stderr is received
			this.emit('progress', {...state});
		});

		// Progress interval - emit updates every 500ms
		// Using unref() so this interval doesn't prevent Node.js from exiting
		// (important for tests and clean shutdown)
		const intervalId = setInterval(() => {
			this.emit('progress', {...state});
		}, INTERVAL_BASH_PROGRESS_MS);
		intervalId.unref();

		const promise = new Promise<BashExecutionState>((resolve, _reject) => {
			// Store resolve function so cancel() can resolve the promise
			this.executions.set(executionId, {
				state,
				process: proc,
				intervalId,
				resolve,
			});

			proc.on('close', (code: number | null) => {
				// Only process if not already handled by cancel()
				if (!this.executions.has(executionId)) return;

				clearInterval(intervalId);
				state.isComplete = true;
				state.exitCode = code;
				this.emit('complete', {...state});
				this.executions.delete(executionId);
				resolve({...state});
			});

			proc.on('error', (error: Error) => {
				// Only process if not already handled by cancel()
				if (!this.executions.has(executionId)) return;

				clearInterval(intervalId);
				state.isComplete = true;
				state.error = error.message;
				this.emit('complete', {...state});
				this.executions.delete(executionId);
				resolve({...state}); // Resolve with error state instead of rejecting
			});
		});

		// Emit initial state
		this.emit('start', {...state});

		return {executionId, promise};
	}

	cancel(executionId: string): boolean {
		const execution = this.executions.get(executionId);
		if (!execution) return false;

		clearInterval(execution.intervalId);

		// Destroy stdio streams to prevent them from keeping the event loop alive
		execution.process.stdout?.destroy();
		execution.process.stderr?.destroy();
		execution.process.stdin?.destroy();

		this.killProcessTree(execution.process);
		execution.state.isComplete = true;
		execution.state.error = 'Cancelled by user';
		this.emit('complete', {...execution.state});

		// Resolve the promise with the cancelled state
		execution.resolve({...execution.state});

		this.executions.delete(executionId);
		return true;
	}

	/**
	 * Terminate a spawned command and its descendants.
	 *
	 * On Unix the child is spawned `detached`, so it leads its own process
	 * group; signalling the negative PID reaches the whole group (the command
	 * plus anything it spawned). Windows has no process groups here, so we fall
	 * back to killing the single process.
	 */
	private killProcessTree(proc: ChildProcess): void {
		const pid = proc.pid;
		if (pid === undefined) return;

		if (isWindows) {
			proc.kill('SIGTERM');
			return;
		}

		try {
			process.kill(-pid, 'SIGTERM');
		} catch {
			// Group already gone (or never formed) - fall back to the lone process.
			try {
				proc.kill('SIGTERM');
			} catch {
				// Process already exited; nothing to terminate.
			}
		}
	}

	getState(executionId: string): BashExecutionState | undefined {
		const execution = this.executions.get(executionId);
		return execution ? {...execution.state} : undefined;
	}

	hasActiveExecutions(): boolean {
		return this.executions.size > 0;
	}

	getActiveExecutionIds(): string[] {
		return Array.from(this.executions.keys());
	}
}

// Singleton instance for app-wide use
export const bashExecutor = new BashExecutor();
