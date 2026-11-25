/**
 * /jobs — list, inspect and stop background `execute_bash` jobs without
 * spending a model turn. The executor owns the jobs; this command is only a
 * user-facing view over it.
 */
import cliTruncate from 'cli-truncate';
import {infoMsg, successMsg, warningMsg} from '@/components/message-factory';
import {DEFAULT_TERMINAL_COLUMNS} from '@/constants';
import {calculateBoxWidth} from '@/hooks/useTerminalWidth';
import {type BashJobInfo, bashExecutor} from '@/services/bash-executor';
import {formatBackgroundOutput} from '@/tools/bash-jobs';
import type {StatefulCommand} from '@/types/index';

const USAGE =
	'Usage: /jobs [id|kill <id>|kill all]\n\n' +
	'  /jobs              List background jobs\n' +
	'  /jobs <id>         Show recent output (does not consume bash_output)\n' +
	'  /jobs kill <id>    Stop one job\n' +
	'  /jobs kill all     Stop every running job';

// Job ids are UUIDs; the first few characters are enough to tell the handful
// of retained jobs apart, and findJobs() accepts a prefix of any length.
const SHORT_ID_LENGTH = 8;
const STATUS_WIDTH = 18;
// Matches the info message's borders and horizontal padding (see expand.ts).
const MESSAGE_BOX_CHROME = 6;
const MIN_COMMAND_LENGTH = 10;

function shortId(jobId: string): string {
	return jobId.slice(0, SHORT_ID_LENGTH);
}

function formatRuntime(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (value: number) => String(value).padStart(2, '0');
	return hours > 0
		? `${hours}:${pad(minutes)}:${pad(seconds)}`
		: `${minutes}:${pad(seconds)}`;
}

function statusText(job: BashJobInfo): string {
	if (!job.isComplete) return 'running';
	if (job.error) return `stopped: ${job.error}`;
	return `exited (${job.exitCode ?? '?'})`;
}

function listText(): string {
	const jobs = bashExecutor.listJobs();
	if (jobs.length === 0) {
		return (
			'No background jobs.\n\n' +
			'Start one with execute_bash and run_in_background: true.'
		);
	}

	const running = jobs.filter(job => !job.isComplete).length;
	const rowWidth = Math.max(
		40,
		calculateBoxWidth(process.stdout.columns || DEFAULT_TERMINAL_COLUMNS) -
			MESSAGE_BOX_CHROME,
	);
	const prefixWidth = 2 + SHORT_ID_LENGTH + 2 + STATUS_WIDTH + 1 + 5 + 2;
	const commandWidth = Math.max(MIN_COMMAND_LENGTH, rowWidth - prefixWidth);
	const rows = jobs.map(job => {
		const command = cliTruncate(
			job.command.replace(/\s+/g, ' ').trim(),
			commandWidth,
		);
		return `  ${shortId(job.jobId).padEnd(SHORT_ID_LENGTH)}  ${statusText(job)
			.slice(0, STATUS_WIDTH)
			.padEnd(
				STATUS_WIDTH,
			)} ${formatRuntime(job.runtimeMs).padStart(5)}  ${command}`;
	});

	return [
		`Background jobs (${running} running, ${jobs.length} total):`,
		'',
		...rows,
		'',
		'Run /jobs <id> for output, /jobs kill <id> or /jobs kill all to stop.',
	].join('\n');
}

/** Exact id first, then an unambiguous prefix. */
function findJobs(input: string): BashJobInfo[] {
	const needle = input.trim().toLowerCase().replace(/^#/, '');
	if (!needle) return [];
	const jobs = bashExecutor.listJobs();
	const exact = jobs.filter(job => job.jobId.toLowerCase() === needle);
	if (exact.length > 0) return exact;
	return jobs.filter(job => job.jobId.toLowerCase().startsWith(needle));
}

function lookupFailure(input: string, matches: BashJobInfo[]): string {
	if (matches.length > 1) {
		return `Ambiguous job id "${input}". Use more characters.`;
	}
	return `No background job matching "${input}". Run /jobs to list jobs.`;
}

function outputText(job: BashJobInfo): string {
	const output = bashExecutor.peekJobOutput(job.jobId);
	if (!output) {
		return `Job ${shortId(job.jobId)} is no longer available. Run /jobs to list jobs.`;
	}
	return (
		`Recent output for ${shortId(job.jobId)} (${job.command}):\n` +
		formatBackgroundOutput(output)
	);
}

export const jobsCommand: StatefulCommand = {
	name: 'jobs',
	description:
		'List background bash jobs, read their output, or stop them (/jobs, /jobs <id>, /jobs kill <id>|all)',
	run: async context => {
		const first = context.args[0];
		if (!first) {
			return {show: infoMsg(listText(), 'jobs-list')};
		}

		if (first.toLowerCase() === 'kill') {
			const target = context.args[1];
			if (!target) return {show: infoMsg(USAGE, 'jobs-usage')};

			if (target.toLowerCase() === 'all') {
				const running = bashExecutor.listJobs().filter(job => !job.isComplete);
				if (running.length === 0) {
					return {
						show: infoMsg(
							'No running background jobs to stop.',
							'jobs-kill-none',
						),
					};
				}
				await Promise.all(running.map(job => bashExecutor.killJob(job.jobId)));
				return {
					show: successMsg(
						`Stopped ${running.length} background job${
							running.length === 1 ? '' : 's'
						}.`,
						'jobs-kill-all',
					),
				};
			}

			const matches = findJobs(target);
			const [job] = matches;
			if (matches.length !== 1 || !job) {
				return {
					show: warningMsg(lookupFailure(target, matches), 'jobs-kill-unknown'),
				};
			}
			await bashExecutor.killJob(job.jobId);
			return {
				show: successMsg(
					`Stopped background job ${shortId(job.jobId)}.`,
					'jobs-kill-one',
				),
			};
		}

		const matches = findJobs(first);
		const [job] = matches;
		if (matches.length !== 1 || !job) {
			return {
				show: warningMsg(lookupFailure(first, matches), 'jobs-unknown'),
			};
		}
		return {show: infoMsg(outputText(job), 'jobs-output')};
	},
};
