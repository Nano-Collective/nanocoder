import test from 'ava';
import {ReviewActivityStore} from './review-activity';
import {type ReviewAgentRun, runReviewAgent} from './review-agent';
import type {ReviewAgentTool} from './review-context';
import {
	createScriptedReviewClient,
	type ReviewScript,
} from './review-client-test-helpers';

function readTool(
	onRun: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string> = async args =>
		`${String(args.path)} (head)\n1: export const value = 1;`,
): ReviewAgentTool {
	return {
		name: 'review_read_file',
		description: 'Read a file',
		parameters: {
			type: 'object',
			properties: {path: {type: 'string', description: 'path'}},
			required: ['path'],
		},
		describe: args => {
			const path = typeof args.path === 'string' ? args.path : '';
			return {args: [path], summary: `Reading ${path}`, path};
		},
		run: onRun,
	};
}

function agentRun(
	script: ReviewScript,
	overrides: Partial<ReviewAgentRun> = {},
): {run: ReviewAgentRun; calls: ReturnType<typeof createScriptedReviewClient>['calls']} {
	const {client, calls} = createScriptedReviewClient(script);
	return {
		calls,
		run: {
			client,
			name: 'finder',
			summary: 'Looking for defects',
			systemPrompt: 'You are a meticulous code reviewer. Test prompt.',
			userPrompt: 'Review this.',
			tools: [readTool()],
			budget: {maxTurns: 5, maxToolCalls: 5},
			toolMode: {disabled: false, format: 'xml'},
			activity: new ReviewActivityStore(),
			...overrides,
		},
	};
}

test('native tool calls run against review tools and results return as tool messages', async t => {
	const {run, calls} = agentRun((_call, index) =>
		index === 0
			? {toolCalls: [{name: 'review_read_file', args: {path: './src/file.ts'}}]}
			: {content: 'NO FINDINGS'},
	);
	const outcome = await runReviewAgent(run);

	t.is(outcome.status, 'completed');
	t.is(outcome.output, 'NO FINDINGS');
	t.is(outcome.turns, 2);
	t.is(outcome.toolCalls, 1);
	t.deepEqual([...outcome.inspectedPaths], ['src/file.ts']);
	t.deepEqual(Object.keys(calls[0]!.tools), ['review_read_file']);
	const toolMessage = calls[1]!.messages.at(-1);
	t.is(toolMessage?.role, 'tool');
	t.is(toolMessage?.tool_call_id, 'call_1');
	t.true(toolMessage?.content.includes('export const value = 1;'));

	const summary = run.activity.toSummary();
	const agent = summary.events.find(event => event.source === 'agent');
	t.is(agent?.status, 'completed');
	t.is(summary.events.filter(event => event.source === 'api').length, 2);
	const toolEvent = summary.events.find(event => event.source === 'tool');
	t.is(toolEvent?.parentId, agent?.id);
	t.deepEqual(toolEvent?.safeArgs, ['./src/file.ts']);
});

test('the tool-call budget is enforced and ends with one tool-free report turn', async t => {
	const {run, calls} = agentRun(
		call =>
			Object.keys(call.tools).length === 0
				? {content: 'NO FINDINGS'}
				: {
						toolCalls: [
							{name: 'review_read_file', args: {path: 'a.ts'}},
							{name: 'review_read_file', args: {path: 'b.ts'}},
							{name: 'review_read_file', args: {path: 'c.ts'}},
						],
					},
		{budget: {maxTurns: 10, maxToolCalls: 2}},
	);
	const outcome = await runReviewAgent(run);

	t.is(outcome.status, 'budget-exhausted');
	t.is(outcome.toolCalls, 2);
	t.is(outcome.output, 'NO FINDINGS');
	t.is(calls.length, 2);
	t.deepEqual(calls[1]!.tools, {});
	const lastPrompt = calls[1]!.messages.at(-1);
	t.is(lastPrompt?.role, 'user');
	t.regex(lastPrompt?.content ?? '', /tool budget for this review is exhausted/);
	const skipped = calls[1]!.messages.find(
		message => message.role === 'tool' && message.content.includes('this call was not run'),
	);
	t.truthy(skipped);
});

test('the turn budget stops a model that never finishes', async t => {
	const {run, calls} = agentRun(
		(call, index) =>
			Object.keys(call.tools).length === 0
				? {content: 'partial report'}
				: {toolCalls: [{name: 'review_read_file', args: {path: `file-${index}.ts`}}]},
		{budget: {maxTurns: 3, maxToolCalls: 50}},
	);
	const outcome = await runReviewAgent(run);
	t.is(outcome.status, 'budget-exhausted');
	t.is(outcome.budgetReason, 'turns');
	t.is(outcome.turns, 4);
	t.is(calls.length, 4);
	t.is(outcome.output, 'partial report');
});

test('repeating the exact same tool call stops through the shared loop guard', async t => {
	const {run} = agentRun(
		() => ({toolCalls: [{name: 'review_read_file', args: {path: 'a.ts'}}]}),
		{budget: {maxTurns: 10, maxToolCalls: 50}},
	);
	const outcome = await runReviewAgent(run);
	t.is(outcome.status, 'failed');
	t.regex(outcome.error ?? '', /repeated the same tool call/i);
	t.is(outcome.toolCalls, 2);
});

test('text fallback advertises tools in the prompt and parses XML calls', async t => {
	const {run, calls} = agentRun(
		(_call, index) =>
			index === 0
				? {content: 'Let me look.\n<review_read_file>\n<path>src/file.ts</path>\n</review_read_file>'}
				: {content: 'NO FINDINGS'},
		{toolMode: {disabled: true, format: 'xml'}},
	);
	const outcome = await runReviewAgent(run);

	t.is(outcome.status, 'completed');
	t.is(outcome.toolCalls, 1);
	t.deepEqual(calls[0]!.tools, {});
	t.true(calls[0]!.messages[0]!.content.includes('review_read_file'));
	const result = calls[1]!.messages.at(-1);
	t.is(result?.role, 'user');
	t.true(result?.content.startsWith('Result of review_read_file:'));
});

test('malformed fallback calls are retried, then fail the agent', async t => {
	const {run, calls} = agentRun(() => ({content: '[tool_use: review_read_file]'}), {
		toolMode: {disabled: true, format: 'xml'},
	});
	const outcome = await runReviewAgent(run);
	t.is(outcome.status, 'failed');
	t.regex(outcome.error ?? '', /malformed tool calls/i);
	t.is(calls.length, 3);
});

test('malformed native-mode text calls get feedback and recover', async t => {
	const {run, calls} = agentRun((_call, index) =>
		index === 0
			? {content: '[tool_use: review_read_file]'}
			: index === 1
				? {content: '<review_read_file><path>src/file.ts</path></review_read_file>'}
				: {content: 'NO FINDINGS'},
	);
	const outcome = await runReviewAgent(run);
	t.is(outcome.status, 'completed');
	t.is(outcome.toolCalls, 1);
	t.is(calls.length, 3);
	t.regex(calls[1]!.messages.at(-1)!.content, /malformed tool call/);
});

test('malformed native-mode text calls fail at the retry cap', async t => {
	const {run, calls} = agentRun(() => ({content: '[tool_use: review_read_file]'}));
	const outcome = await runReviewAgent(run);
	t.is(outcome.status, 'failed');
	t.regex(outcome.error ?? '', /malformed tool calls/i);
	t.is(calls.length, 3);
});

test('native models that regress to text calls still run review tools, but quoted markup is not a call', async t => {
	const regressed = agentRun((_call, index) =>
		index === 0
			? {content: '<review_read_file>\n<path>src/file.ts</path>\n</review_read_file>'}
			: {content: 'NO FINDINGS'},
	);
	const outcome = await runReviewAgent(regressed.run);
	t.is(outcome.status, 'completed');
	t.is(outcome.toolCalls, 1);

	const report = [
		'FINDING',
		'FILE: src/view.tsx',
		'LINE: 3',
		'SEVERITY: medium',
		'ISSUE: key missing',
		'EVIDENCE: <Box>\n<Text>row</Text>\n</Box>',
		'END',
	].join('\n');
	for (const disabled of [false, true]) {
		const quoted = agentRun(() => ({content: report}), {
			toolMode: {disabled, format: 'xml'},
		});
		const quotedOutcome = await runReviewAgent(quoted.run);
		t.is(quotedOutcome.status, 'completed');
		t.is(quotedOutcome.toolCalls, 0);
		t.is(quotedOutcome.output, report);
	}
});

test('unknown tools return an error to the model and are recorded as failed', async t => {
	const {run, calls} = agentRun((_call, index) =>
		index === 0
			? {toolCalls: [{name: 'execute_bash', args: {command: 'rm -rf /'}}]}
			: {content: 'NO FINDINGS'},
	);
	const outcome = await runReviewAgent(run);
	t.is(outcome.status, 'completed');
	t.regex(calls[1]!.messages.at(-1)?.content ?? '', /execute_bash is not available/);
	const event = run.activity.toSummary().events.find(entry => entry.name === 'execute_bash');
	t.is(event?.status, 'failed');
});

test('aborting during a tool call cancels the agent', async t => {
	const controller = new AbortController();
	const {run} = agentRun(
		() => ({toolCalls: [{name: 'review_read_file', args: {path: 'a.ts'}}]}),
		{
			signal: controller.signal,
			tools: [
				readTool(async () => {
					controller.abort();
					throw new Error('Git command cancelled');
				}),
			],
		},
	);
	const outcome = await runReviewAgent(run);
	t.is(outcome.status, 'cancelled');
	const events = run.activity.toSummary().events;
	t.is(events.find(event => event.source === 'agent')?.status, 'cancelled');
	t.is(events.find(event => event.source === 'tool')?.status, 'cancelled');
});

test('a model error fails the agent with its message', async t => {
	const {run} = agentRun(() => {
		throw new Error('connection refused');
	});
	const outcome = await runReviewAgent(run);
	t.is(outcome.status, 'failed');
	t.is(outcome.error, 'connection refused');
	t.is(
		run.activity.toSummary().events.find(event => event.source === 'api')?.status,
		'failed',
	);
});

test('output-limit truncation keeps the report but marks it partial', async t => {
	const {run} = agentRun(() => ({
		content: 'NO FINDINGS',
		finishReason: 'length',
	}));
	const outcome = await runReviewAgent(run);
	t.is(outcome.output, 'NO FINDINGS');
	t.regex(outcome.incompleteReason ?? '', /finder output was cut off/);
});

test('context budget stops before overflowing a small context window and runs a tool-free final turn', async t => {
	const {client, calls} = createScriptedReviewClient(
		(call, index) =>
			Object.keys(call.tools).length === 0
				? {content: 'NO FINDINGS'}
				: {
						toolCalls: [
							{name: 'review_read_file', args: {path: `file-${index}.ts`}},
						],
					},
		{contextSize: 8_000},
	);
	const {run} = agentRun(() => ({}), {
		client,
		budget: {maxTurns: 14, maxToolCalls: 24},
		tools: [
			readTool(async args => `${String(args.path)}\n${'x'.repeat(10_000)}`),
		],
	});
	const outcome = await runReviewAgent(run);
	t.is(outcome.status, 'budget-exhausted');
	t.is(outcome.budgetReason, 'context');
	t.is(outcome.output, 'NO FINDINGS');
	t.regex(outcome.incompleteReason ?? '', /model context limit/);
	t.true(outcome.toolCalls <= 2);
	t.deepEqual(calls.at(-1)?.tools, {});
	const lastPrompt = calls.at(-1)?.messages.at(-1);
	t.is(lastPrompt?.role, 'user');
	t.regex(lastPrompt?.content ?? '', /context budget for this review is nearly full/);
});


test('an unknown context size still bounds the run with a small default window', async t => {
	const {client} = createScriptedReviewClient((call, index) =>
		Object.keys(call.tools).length === 0
			? {content: 'NO FINDINGS'}
			: {
					toolCalls: [
						{name: 'review_read_file', args: {path: `file-${index}.ts`}},
					],
				},
	);
	const {run} = agentRun(() => ({}), {
		client,
		budget: {maxTurns: 14, maxToolCalls: 24},
		tools: [
			readTool(async args => `${String(args.path)}\n${'x'.repeat(12_000)}`),
		],
	});
	const outcome = await runReviewAgent(run);
	t.is(outcome.status, 'budget-exhausted');
	t.is(outcome.budgetReason, 'context');
	t.true(outcome.toolCalls < 24);
});
