import {type ChildProcess, spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import type {TaskDefinition} from './tasks';

const KILL_GRACE_MS = 3000;

export type WorkerEvent = {type: 'turn'} | {type: 'tool'; tool: string};

export interface RunWorkerOptions {
	cliPath: string;
	cliArgs: string[];
	cwd: string;
	logPath: string;
	reportPath: string;
	signal: AbortSignal;
	onEvent: (event: WorkerEvent) => void;
}

export function buildWorkerPrompt(task: TaskDefinition, goal: string): string {
	return [
		'You are one of several agents working in parallel, each in a separate copy of this repository.',
		`Overall goal: ${goal}`,
		`Your task: ${task.description}`,
		`You may only create or edit files within: ${task.fileScope.map(entry => entry || '.').join(', ')}`,
		'Do only your task. The other parts are handled by other agents, whose changes you will not see. Do not commit.',
	].join('\n\n');
}

function parseEvent(line: string): WorkerEvent | undefined {
	if (!line.startsWith('{')) return undefined;
	try {
		const event = JSON.parse(line) as {type?: unknown; tool?: unknown};
		if (event.type === 'turn') return {type: 'turn'};
		if (event.type === 'tool' && typeof event.tool === 'string') {
			return {type: 'tool', tool: event.tool};
		}
	} catch {}
	return undefined;
}

/** Signals the whole process group, so a worker's shell commands go with it. */
function signalWorker(child: ChildProcess, signal: NodeJS.Signals): void {
	try {
		if (process.platform !== 'win32' && child.pid) {
			process.kill(-child.pid, signal);
		} else {
			child.kill(signal);
		}
	} catch {
		// It has already exited.
	}
}

interface WorkerReport {
	kind?: string;
	message?: string;
	usage?: {totalTokens?: number};
}

function parseReport(stdout: string): WorkerReport | undefined {
	const trimmed = stdout.trim();
	for (const candidate of [
		trimmed,
		trimmed.slice(trimmed.lastIndexOf('\n{\n') + 1),
	]) {
		try {
			return JSON.parse(candidate) as WorkerReport;
		} catch {}
	}
	return undefined;
}

/**
 * Runs one headless `nanocoder run` and resolves only once the process has
 * exited, so its worktree is safe to read or remove afterwards.
 */
export async function runWorker({
	cliPath,
	cliArgs,
	cwd,
	logPath,
	reportPath,
	signal,
	onEvent,
}: RunWorkerOptions): Promise<{tokens: number}> {
	signal.throwIfAborted();

	const log = createWriteStream(logPath, {flags: 'a'});
	const child = spawn(process.execPath, [cliPath, ...cliArgs], {
		cwd,
		env: process.env,
		// `run` waits for end of input on a piped stdin.
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: process.platform !== 'win32',
	});

	let stdout = '';
	let pending = '';
	const handleLine = (line: string) => {
		const event = parseEvent(line);
		if (event) onEvent(event);
		else if (line.trim()) log.write(`${line}\n`);
	};
	child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
		stdout += chunk;
	});
	child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
		const lines = (pending + chunk).split('\n');
		pending = lines.pop() ?? '';
		for (const line of lines) handleLine(line);
	});

	let killTimer: NodeJS.Timeout | undefined;
	const stop = () => {
		signalWorker(child, 'SIGTERM');
		killTimer = setTimeout(() => signalWorker(child, 'SIGKILL'), KILL_GRACE_MS);
	};
	signal.addEventListener('abort', stop, {once: true});
	// A detached group survives the parent, so a forced exit has to take it down.
	const killOnExit = () => signalWorker(child, 'SIGKILL');
	process.once('exit', killOnExit);

	try {
		const code = await new Promise<number | null>((resolve, reject) => {
			child.once('error', reject);
			child.once('close', resolve);
		});
		if (pending) handleLine(pending);
		await writeFile(reportPath, stdout);
		signal.throwIfAborted();

		const report = parseReport(stdout);
		if (code !== 0 || report?.kind !== 'success') {
			const reason =
				report?.message ??
				(report?.kind && report.kind !== 'success'
					? report.kind
					: `exit code ${code}`);
			throw new Error(`${reason} (log: ${logPath})`);
		}
		return {tokens: report.usage?.totalTokens ?? 0};
	} finally {
		process.removeListener('exit', killOnExit);
		signal.removeEventListener('abort', stop);
		if (killTimer) clearTimeout(killTimer);
		// Anything the worker left running in its group would outlive the swarm.
		if (process.platform !== 'win32') signalWorker(child, 'SIGKILL');
		await new Promise<void>(resolve => log.end(resolve));
	}
}
