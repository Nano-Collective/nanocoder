import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {bashExecutor, type BashJobOutput} from '@/services/bash-executor';
import {bashOutputTool} from '@/tools/bash-output';
import {
	formatBackgroundOutput,
	formatBackgroundStart,
	formatKillResult,
	readBackgroundStart,
} from '@/tools/bash-jobs';
import {executeBashTool} from '@/tools/execute-bash';
import {killBashTool} from '@/tools/kill-bash';

console.log('\nbash-jobs.spec.ts');

// A script file, because cmd.exe mangles the quotes of an inline `node -e`.
const dir = mkdtempSync(join(tmpdir(), 'nc-bash-jobs-spec-'));
const script = join(dir, 'job.js');
writeFileSync(
	script,
	"console.log('started'); let i = 0; setInterval(() => console.log('tick ' + (++i)), 200);\n",
);
const JOB_COMMAND = `node "${script}"`;

const toolOptions = {toolCallId: 'test', messages: []};

test.afterEach.always(async () => {
	await bashExecutor.stopAll();
});

test.after.always(() => {
	rmSync(dir, {recursive: true, force: true});
});

function makeJob(overrides: Partial<BashJobOutput> = {}): BashJobOutput {
	return {
		jobId: 'job-1',
		command: 'pnpm dev',
		output: '',
		stderr: '',
		isComplete: false,
		exitCode: null,
		error: null,
		...overrides,
	};
}

test('readBackgroundStart returns the first output and consumes it', async t => {
	const {executionId} = bashExecutor.execute(JOB_COMMAND, {background: true});
	const job = await readBackgroundStart(executionId);
	t.truthy(job);
	t.true(job!.output.includes('started'));

	const next = bashExecutor.readJobOutput(executionId);
	t.truthy(next);
	t.false(next!.output.includes('started'), 'a second read must not repeat it');

	await bashExecutor.killJob(executionId);
});

test('formatBackgroundStart reports the job id, status and first output', t => {
	const text = formatBackgroundStart(
		makeJob({output: 'ready in 312 ms\n'}),
	);
	t.true(text.includes('JOB_ID: job-1'));
	t.true(text.includes('STATUS: running'));
	t.true(text.includes('COMMAND: pnpm dev'));
	t.true(text.includes('ready in 312 ms'));
	t.true(text.includes('Use bash_output'));
});

test('formatBackgroundOutput reports new output or says there is none', t => {
	const withOutput = formatBackgroundOutput(
		makeJob({output: 'compiled\n', isComplete: true, exitCode: 0}),
	);
	t.true(withOutput.includes('STATUS: exited with code 0'));
	t.true(withOutput.includes('compiled'));

	const empty = formatBackgroundOutput(makeJob());
	t.true(empty.includes('No new output since the last read.'));
});

test('formatBackgroundOutput reports how a job was stopped', t => {
	const text = formatBackgroundOutput(
		makeJob({isComplete: true, error: 'Killed by user'}),
	);
	t.true(text.includes('STATUS: stopped: Killed by user'));
});

test('formatKillResult says the job has been stopped', t => {
	const text = formatKillResult(makeJob({isComplete: true, error: 'Killed by user'}));
	t.true(text.includes('JOB_ID: job-1'));
	t.true(text.includes('The background job has been stopped.'));
});

test('execute_bash run_in_background returns a job id', async t => {
	const result = await executeBashTool.tool.execute!(
		{command: JOB_COMMAND, run_in_background: true},
		toolOptions,
	);

	t.false(result.isError);
	const jobId = result.llmContent.match(/JOB_ID: (\S+)/)?.[1];
	t.truthy(jobId);
	t.truthy(bashExecutor.readJobOutput(jobId!));

	await bashExecutor.killJob(jobId!);
});

test('bash_output returns output for a running job', async t => {
	const {executionId} = bashExecutor.execute(JOB_COMMAND, {background: true});
	await readBackgroundStart(executionId);

	const content = await bashOutputTool.tool.execute!(
		{job_id: executionId},
		toolOptions,
	);

	t.true(content.includes(`JOB_ID: ${executionId}`));
	t.true(content.includes('STATUS: running'));

	await bashExecutor.killJob(executionId);
});

test('kill_bash stops the job', async t => {
	const {executionId} = bashExecutor.execute(JOB_COMMAND, {background: true});
	await readBackgroundStart(executionId);

	const content = await killBashTool.tool.execute!(
		{job_id: executionId},
		toolOptions,
	);

	t.true(content.includes('The background job has been stopped.'));
	t.true(bashExecutor.getState(executionId)!.isComplete);
});

test('bash_output and kill_bash reject an unknown job id', async t => {
	await t.throwsAsync(
		bashOutputTool.tool.execute!({job_id: 'missing'}, toolOptions),
	);
	await t.throwsAsync(
		killBashTool.tool.execute!({job_id: 'missing'}, toolOptions),
	);
});

test('bash_output is read-only and kill_bash never prompts', t => {
	t.true(bashOutputTool.readOnly);
	t.not(killBashTool.readOnly, true);
	t.is(killBashTool.approval, false);
});

test('both tools reject an empty job_id', async t => {
	const output = await bashOutputTool.validator!({job_id: ' '});
	t.false(output.valid);

	const kill = await killBashTool.validator!({job_id: ''});
	t.false(kill.valid);
});
