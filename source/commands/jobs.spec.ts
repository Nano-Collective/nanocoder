import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type React from 'react';
import {bashExecutor} from '@/services/bash-executor';
import {startBackgroundJob} from '@/tools/bash-jobs';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {CommandContext} from '@/types/index';
import {jobsCommand} from './jobs';

console.log('\njobs.spec.ts');

// A script file: cmd.exe mangles the quotes of an inline `node -e`.
const dir = mkdtempSync(join(tmpdir(), 'nc-jobs-command-spec-'));
const script = join(dir, 'job.js');
writeFileSync(script, "console.log('started'); setInterval(() => {}, 1000);\n");
const JOB_COMMAND = `node "${script}"`;

// Prints once inside readBackgroundStart's wait, then once after the model's
// first read so `/jobs <id>` can be checked against genuinely newer output.
const lateScript = join(dir, 'late-job.js');
writeFileSync(
	lateScript,
	"console.log('started'); setTimeout(() => console.log('LATE_MARKER'), 1500); setInterval(() => {}, 1000);\n",
);
const LATE_JOB_COMMAND = `node "${lateScript}"`;

test.afterEach.always(async () => {
	await bashExecutor.stopAll();
});

test.after.always(() => {
	rmSync(dir, {recursive: true, force: true});
});

async function runJobs(args: string[]): Promise<string> {
	const result = await jobsCommand.run({
		args,
		argText: args.join(' '),
		rawArgs: args,
	} as unknown as CommandContext);
	if (typeof result !== 'object' || result === null || !('show' in result)) {
		throw new Error('expected /jobs to show a message');
	}
	const {lastFrame} = renderWithTheme(result.show as React.ReactElement);
	return lastFrame() ?? '';
}

/** Start a job and wait for its first line so output assertions are stable. */
async function startJob(): Promise<string> {
	const {executionId} = bashExecutor.execute(JOB_COMMAND, {background: true});
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		if (bashExecutor.peekJobOutput(executionId)?.output) break;
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	return executionId;
}

test('/jobs reports when there are no background jobs', async t => {
	t.true((await runJobs([])).includes('No background jobs'));
});

test('/jobs lists a running job with its id, status and command', async t => {
	const id = await startJob();
	const output = await runJobs([]);
	t.true(output.includes('Background jobs (1 running'));
	t.true(output.includes(id.slice(0, 8)));
	t.true(output.includes('running'));
	t.true(output.includes('node'));
});

test('/jobs <id> shows output without consuming the bash_output cursor', async t => {
	const id = await startJob();
	const before = bashExecutor.peekJobOutput(id)!.output;
	t.truthy(before, 'the job should have printed its banner');

	const output = await runJobs([id]);
	t.true(output.includes('Recent output'));
	t.is(
		bashExecutor.peekJobOutput(id)!.output,
		before,
		'viewing output in the TUI must not advance the cursor',
	);
	t.is(
		bashExecutor.readJobOutput(id)!.output,
		before,
		'the model still reads the same text on its next bash_output',
	);
});

test('/jobs <id> shows startup output already read by the model', async t => {
	const {job} = await startBackgroundJob(JOB_COMMAND);
	t.truthy(job, 'the job should start through the production path');
	const id = job!.jobId;
	t.true(job!.output.includes('started'), 'the start read sees the banner');

	const afterStart = bashExecutor.readJobOutput(id)!;
	t.false(
		afterStart.output.includes('started'),
		'startBackgroundJob consumed the banner',
	);

	const output = await runJobs([id]);
	t.true(
		output.includes('started'),
		'the TUI still shows output the model already read',
	);
	t.false(
		bashExecutor.readJobOutput(id)!.output.includes('started'),
		'inspecting output must not put consumed text back in the cursor',
	);
});

test('/jobs <id> shows output read by a later bash_output call', async t => {
	const {job} = await startBackgroundJob(LATE_JOB_COMMAND);
	t.truthy(job, 'the job should start through the production path');
	const id = job!.jobId;
	t.false(
		job!.output.includes('LATE_MARKER'),
		'the start read should only see the banner',
	);

	const deadline = Date.now() + 4000;
	while (
		!bashExecutor.peekJobOutput(id)?.output.includes('LATE_MARKER') &&
		Date.now() < deadline
	) {
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	const consumed = bashExecutor.readJobOutput(id)!;
	t.true(consumed.output.includes('LATE_MARKER'), 'bash_output reads the marker');

	const output = await runJobs([id]);
	t.true(output.includes('LATE_MARKER'), 'the TUI must show retained output');
	t.true(output.includes('started'), 'the startup banner remains visible too');
	t.false(
		bashExecutor.readJobOutput(id)!.output.includes('LATE_MARKER'),
		'peeking must not consume or replay the text bash_output already read',
	);
});

test('/jobs <id> reports live status after the model start read', async t => {
	const {job} = await startBackgroundJob(JOB_COMMAND);
	t.truthy(job);
	const id = job!.jobId;
	t.false(job!.isComplete);

	await bashExecutor.killJob(id);
	const output = await runJobs([id]);
	t.regex(output, /STATUS: stopped/);
});

test('/jobs accepts an unambiguous job id prefix', async t => {
	const id = await startJob();
	const output = await runJobs([id.slice(0, 6)]);
	t.true(output.includes('Recent output'));
	t.true(output.includes(id.slice(0, 8)));
});

test('/jobs warns on an unknown job id', async t => {
	const output = await runJobs(['does-not-exist']);
	t.true(output.includes('No background job matching'));
});

test('/jobs kill <id> stops the job', async t => {
	const id = await startJob();
	const output = await runJobs(['kill', id]);
	t.true(output.includes('Stopped background job'));
	t.true(bashExecutor.getState(id)!.isComplete);
	t.is(bashExecutor.getRunningJobCount(), 0);
});

test('/jobs kill all stops every running job', async t => {
	const first = await startJob();
	const second = await startJob();
	const output = await runJobs(['kill', 'all']);
	t.true(output.includes('Stopped 2 background jobs'));
	t.is(bashExecutor.getRunningJobCount(), 0);
	t.true(bashExecutor.getState(first)!.isComplete);
	t.true(bashExecutor.getState(second)!.isComplete);
});

test('/jobs kill all is a no-op when nothing is running', async t => {
	const output = await runJobs(['kill', 'all']);
	t.true(output.includes('No running background jobs to stop'));
});

test('/jobs kill without a target shows usage', async t => {
	const output = await runJobs(['kill']);
	t.true(output.includes('Usage: /jobs [id|kill'));
});
