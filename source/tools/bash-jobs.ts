import {
	BASH_BACKGROUND_START_DELAY_MS,
	TRUNCATION_OUTPUT_LIMIT,
} from '@/constants';
import {type BashJobOutput, bashExecutor} from '@/services/bash-executor';
import {truncateToolResult} from '@/utils/truncate-tool-result';

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

/**
 * Result of starting a background job: its id, its state, and whatever it
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

/** Result of `kill_bash`: the job is stopped (or had already exited). */
export function formatKillResult(job: BashJobOutput): string {
	return truncateToolResult(
		`JOB_ID: ${job.jobId}\nSTATUS: ${describeStatus(job)}\nThe background job has been stopped.`,
		TRUNCATION_OUTPUT_LIMIT,
	);
}
