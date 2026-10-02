import test from 'ava';
import type {SubagentResult, SubagentTask} from '@/subagents/types';
import type {DevelopmentMode} from '@/types/core';
import {
	buildPromptRunnerConfig,
	createPromptRunner,
	MAX_PROMPT_LENGTH,
	PROMPT_RUNNER_AGENT,
	parsePromptRequest,
} from './prompt-runner';

console.log(`\nprompt-runner.spec.ts`);

function okResult(output: string): SubagentResult {
	return {
		subagentName: PROMPT_RUNNER_AGENT,
		output,
		success: true,
		executionTimeMs: 1,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (err: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {promise, resolve, reject};
}

test('parsePromptRequest rejects anything that is not a usable prompt', t => {
	t.deepEqual(parsePromptRequest(null), {error: 'prompt params must be an object'});
	t.deepEqual(parsePromptRequest('hi'), {error: 'prompt params must be an object'});
	t.deepEqual(parsePromptRequest([]), {error: 'prompt params must be an object'});
	t.deepEqual(parsePromptRequest({}), {error: 'prompt must be a non-empty string'});
	t.deepEqual(parsePromptRequest({prompt: '   '}), {
		error: 'prompt must be a non-empty string',
	});
	t.deepEqual(parsePromptRequest({prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1)}), {
		error: `prompt exceeds ${MAX_PROMPT_LENGTH} characters`,
	});
	t.deepEqual(parsePromptRequest({prompt: 'hi', mode: 'yolo'}), {
		error: 'mode must be one of: headless, plan',
	});
	t.deepEqual(parsePromptRequest({prompt: 'hi', source: 42}), {
		error: 'source must be a string',
	});
});

test('parsePromptRequest keeps only the known fields and trims the source', t => {
	const parsed = parsePromptRequest({
		prompt: 'fix the build',
		mode: 'plan',
		source: `  telegram:1${'2'.repeat(300)}  `,
		extra: 'dropped',
	});
	t.is(parsed.error, undefined);
	if (parsed.error !== undefined) return;
	t.is(parsed.request.prompt, 'fix the build');
	t.is(parsed.request.mode, 'plan');
	t.is(parsed.request.source?.length, 200);
	t.false('extra' in parsed.request);
	t.deepEqual(parsePromptRequest({prompt: 'hi', source: '  '}), {
		request: {prompt: 'hi'},
	});
});

test('run executes under the runner agent in headless mode by default', async t => {
	const tasks: SubagentTask[] = [];
	const modes: DevelopmentMode[] = [];
	const runner = createPromptRunner({
		buildExecutor: mode => {
			modes.push(mode);
			return {
				execute: async task => {
					tasks.push(task);
					return okResult('done');
				},
			};
		},
	});

	const result = await runner.run({prompt: 'summarize the logs'});

	t.deepEqual(modes, ['headless']);
	t.is(tasks[0]?.subagent_type, PROMPT_RUNNER_AGENT);
	t.is(tasks[0]?.prompt, 'summarize the logs');
	t.true(result.success);
	t.is(result.output, 'done');
	t.is(result.error, undefined);
	t.is(result.checkpointId, undefined);
});

test('run checkpoints before a headless run but not before a plan run', async t => {
	const reasons: string[] = [];
	const runner = createPromptRunner({
		buildExecutor: () => ({execute: async () => okResult('')}),
		checkpointer: {
			create: async reason => {
				reasons.push(reason);
				return `cp-${reasons.length}`;
			},
		},
	});

	const headless = await runner.run({prompt: 'go', source: 'telegram:7'});
	const plan = await runner.run({prompt: 'go', mode: 'plan', source: 'telegram:7'});

	t.is(headless.checkpointId, 'cp-1');
	t.is(plan.checkpointId, undefined);
	t.deepEqual(reasons, ['prompt:telegram:7']);
});

test('a failing checkpoint does not stop the run', async t => {
	const runner = createPromptRunner({
		buildExecutor: () => ({execute: async () => okResult('ran anyway')}),
		checkpointer: {
			create: async () => {
				throw new Error('disk full');
			},
		},
	});

	const result = await runner.run({prompt: 'go'});

	t.true(result.success);
	t.is(result.output, 'ran anyway');
	t.is(result.checkpointId, undefined);
});

test('an executor that throws becomes a failed result, and reports activity', async t => {
	const activities: Array<{success: boolean; error?: string}> = [];
	const runner = createPromptRunner({
		buildExecutor: () => ({
			execute: async () => {
				throw new Error('provider down');
			},
		}),
		onActivity: activity => {
			activities.push({
				success: activity.result.success,
				error: activity.result.error,
			});
		},
	});

	const result = await runner.run({prompt: 'go'});

	t.false(result.success);
	t.is(result.output, '');
	t.is(result.error, 'provider down');
	t.deepEqual(activities, [{success: false, error: 'provider down'}]);
});

test('runs are serialized: the second starts only after the first finishes', async t => {
	const first = deferred<SubagentResult>();
	const started: string[] = [];
	const runner = createPromptRunner({
		buildExecutor: () => ({
			execute: async task => {
				started.push(task.prompt ?? '');
				if (task.prompt === 'one') return first.promise;
				return okResult('two done');
			},
		}),
	});

	const one = runner.run({prompt: 'one'});
	const two = runner.run({prompt: 'two'});
	await new Promise(r => setTimeout(r, 10));
	t.deepEqual(started, ['one']);

	first.resolve(okResult('one done'));
	t.is((await one).output, 'one done');
	t.is((await two).output, 'two done');
	t.deepEqual(started, ['one', 'two']);
});

test('a rejected run does not block the ones queued behind it', async t => {
	let calls = 0;
	const runner = createPromptRunner({
		buildExecutor: () => ({
			execute: async () => {
				calls++;
				if (calls === 1) throw new Error('boom');
				return okResult('second');
			},
		}),
	});

	const [a, b] = await Promise.all([
		runner.run({prompt: 'a'}),
		runner.run({prompt: 'b'}),
	]);

	t.false(a.success);
	t.true(b.success);
	t.is(b.output, 'second');
});

test('buildPromptRunnerConfig registers a built-in agent with no tool allowlist', t => {
	const config = buildPromptRunnerConfig();
	t.is(config.name, PROMPT_RUNNER_AGENT);
	t.true(config.source.isBuiltIn);
	t.is(config.tools, undefined);
	t.is(config.model, 'inherit');
	t.regex(config.systemPrompt, /never ask for clarification/);
});
