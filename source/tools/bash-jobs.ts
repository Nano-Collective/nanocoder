import {
	BASH_BACKGROUND_START_DELAY_MS,
	TRUNCATION_OUTPUT_LIMIT,
} from '@/constants';
import {type BashJobOutput, bashExecutor} from '@/services/bash-executor';
import {truncateToolResult} from '@/tools/runtime/truncate-tool-result';

/**
 * How long `execute_bash run_in_background` waits for the job's first output
 * before handing the job id back. A server prints its startup banner in this
 * window; a command that prints nothing just returns an empty preview.
 */
export async function readBackgroundStart(
	jobId: string,
): Promise<BashJobOutput | undefined> {
	await new Promise(resolve =>
		setTimeout(resolve, BASH_BACKGROUND_START_DELAY_MS),
	);
	return bashExecutor.readJobOutput(jobId);
}

function describeStatus(job: BashJobOutput): string {
	if (!job.isComplete) return 'running';
	if (job.error) return `stopped: ${job.error}`;
	return `exited with code ${job.exitCode ?? 'unknown'}`;
}

/** Result of starting a background job: its id, its state, and whatever it
 * printed in the first second. The id is what the model passes to
 * `bash_output` and `kill_bash`.
 */
export function formatBackgroundStart(job: BashJobOutput): string {
	const lines = [
		`JOB_ID: ${job.jobId}`,
		`STATUS: ${describeStatus(job)}`,
		`COMMAND: ${job.command}`,
		'Use bash_output with this job_id to read more, or kill_bash to stop it.',
	];
	if (job.output) lines.push(`STDOUT:\n${job.output.trimEnd()}`);
	if (job.stderr) lines.push(`STDERR:\n${job.stderr.trimEnd()}`);
	return truncateToolResult(lines.join('\n'), TRUNCATION_OUTPUT_LIMIT);
}

/**
 * Start a background job through the same executor path a normal
 * `execute_bash` uses, then wait for its first output. Shared by the registry
 * handler and the streaming executor so both entry points cannot drift apart.
 *
 * Returns the job, or the failure text for the model when the job could not
 * start or failed before it could be reported as a healthy background run.
 */
export async function startBackgroundJob(
	command: string,
	options?: {sessionId?: string},
): Promise<{job?: BashJobOutput; error?: string}> {
	const {executionId} = bashExecutor.execute(command, {
		background: true,
		sessionId: options?.sessionId,
	});
	const job = await readBackgroundStart(executionId);
	if (!job) {
		return {
			error: `Error: background job ${executionId} could not be started.`,
		};
	}
	// A background run fails when the spawn failed (error set, no exit code) or
	// when it exited on its own with a non-zero code — same signal as a
	// foreground run's failure.
	const failed =
		job.error !== null ||
		(job.isComplete && job.exitCode !== null && job.exitCode !== 0);
	if (failed) {
		return {error: formatBackgroundStart(job)};
	}
	return {job};
}

/**
 * Result of `bash_output`: only the text produced since the previous read,
 * plus whether the job is still running or how it exited.
 */
export function formatBackgroundOutput(job: BashJobOutput): string {
	const lines = [`JOB_ID: ${job.jobId}`, `STATUS: ${describeStatus(job)}`];
	if (!job.output && !job.stderr) {
		lines.push('No new output since the last read.');
	} else {
		if (job.output) lines.push(`STDOUT:\n${job.output.trimEnd()}`);
		if (job.stderr) lines.push(`STDERR:\n${job.stderr.trimEnd()}`);
	}
	return truncateToolResult(lines.join('\n'), TRUNCATION_OUTPUT_LIMIT);
}

/** Result of `kill_bash`: the job is stopped, or had already exited. */
export function formatKillResult(job: BashJobOutput): string {
	const action =
		job.error !== null
			? 'The background job has been stopped.'
			: 'The background job had already exited before it could be stopped.';
	return truncateToolResult(
		`JOB_ID: ${job.jobId}\nSTATUS: ${describeStatus(job)}\n${action}`,
		TRUNCATION_OUTPUT_LIMIT,
	);
}
