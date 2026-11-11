import test from 'ava';
import {getRetryLimits} from '@/config/index';
import {partitionUnknownToolCalls} from '@/hooks/chat-handler/utils/tool-filters';
import type {ToolManager} from '@/tools/tool-manager';
import type {
	LLMChatResponse,
	LLMClient,
	Message,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {
	runTurnEngine,
	type TurnEngineAdapter,
	type TurnEngineOptions,
} from './turn-engine';

type Reply = Partial<LLMChatResponse> | Error;

function makeClient(replies: Reply[], seen: Message[][] = []): LLMClient {
	let index = 0;
	return {
		getCurrentModel: () => 'fake-model',
		getProviderConfig: () => ({}),
		getContextSize: () => 100_000,
		chat: async (messages: Message[]) => {
			seen.push(messages);
			const reply = replies[index++];
			if (!reply) throw new Error('scripted client ran out of replies');
			if (reply instanceof Error) throw reply;
			return {
				choices: reply.choices ?? [{message: {role: 'assistant', content: ''}}],
				toolsDisabled: reply.toolsDisabled,
				finishReason: reply.finishReason,
			} as LLMChatResponse;
		},
	} as unknown as LLMClient;
}

const toolManager = {
	hasTool: (name: string) => name === 'probe',
	getToolNames: () => ['probe'],
} as unknown as ToolManager;

const text = (content: string): Reply => ({
	choices: [{message: {role: 'assistant', content}}],
});
const call = (id: string): Reply => ({
	choices: [
		{
			message: {
				role: 'assistant',
				content: '',
				tool_calls: [{id, function: {name: 'probe', arguments: {id}}}],
			},
		},
	],
});
const resultFor = (toolCall: ToolCall): ToolResult => ({
	tool_call_id: toolCall.id,
	role: 'tool',
	name: toolCall.function.name,
	content: 'ok',
});

function setup<S = never>(
	replies: Reply[],
	overrides: Partial<TurnEngineAdapter<S>> = {},
	options: Partial<TurnEngineOptions<S>> = {},
) {
	let history: Message[] = [{role: 'user', content: 'go'}];
	const requests: Message[][] = [];
	const adapter: TurnEngineAdapter<S> = {
		history: {
			get: () => history,
			set: next => {
				history = next;
			},
		},
		getSystemMessage: () => ({role: 'system', content: 'sys'}),
		prepareTurn: () => ({tools: {probe: {} as never}, availableNames: ['probe']}),
		beginModelCall: () => ({callbacks: {}, reasoning: () => undefined}),
		partitionToolCalls: calls => partitionUnknownToolCalls(calls, toolManager),
		executeTools: async calls => ({
			kind: 'continue',
			results: calls.map(resultFor),
		}),
		...overrides,
	};
	const run = () =>
		runTurnEngine<S>({
			client: makeClient(replies, requests),
			signal: new AbortController().signal,
			maxTurns: 10,
			retryLimits: getRetryLimits(),
			adapter,
			...options,
		});
	return {run, requests, history: () => history};
}

test('loops through tool turns without recursion and writes history through the adapter', async t => {
	const {run, history} = setup([call('a'), call('b'), text('done')]);
	const result = await run();
	t.deepEqual(result, {kind: 'completed', modelCalls: 3});
	t.deepEqual(
		history().map(m => m.role),
		['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant'],
	);
});

test('a model call that throws is a model-error, and still counts as a call', async t => {
	const failure = new Error('boom');
	let ended = 0;
	const {run} = setup([call('a'), failure], {
		beginModelCall: () => ({
			callbacks: {},
			reasoning: () => undefined,
			end: () => {
				ended++;
			},
		}),
	});
	const result = await run();
	t.deepEqual(result, {kind: 'model-error', error: failure, modelCalls: 2});
	t.is(ended, 2, 'end() runs for the failed call too');
});

test('a call that throws after an abort is reported as aborted', async t => {
	const controller = new AbortController();
	const client = {
		...makeClient([]),
		chat: async () => {
			controller.abort();
			throw new Error('aborted by signal');
		},
	} as unknown as LLMClient;
	const {run} = setup([], {}, {client, signal: controller.signal});
	const result = await run();
	t.is(result.kind, 'aborted');
	t.is(result.modelCalls, 1);
	if (result.kind === 'aborted') {
		t.is((result.error as Error).message, 'aborted by signal');
	}
});

test('no system message ends the run before calling the model', async t => {
	const {run, requests} = setup([text('done')], {
		getSystemMessage: () => undefined,
	});
	t.deepEqual(await run(), {kind: 'no-system-message', modelCalls: 0});
	t.is(requests.length, 0);
});

test('an empty choices array is no-response', async t => {
	const {run} = setup([{choices: []}]);
	t.deepEqual(await run(), {kind: 'no-response', modelCalls: 1});
});

test('an adapter stop records its results before returning the payload', async t => {
	const {run, history} = setup<string>([call('a')], {
		executeTools: async calls => ({
			kind: 'stop',
			payload: 'needs-approval',
			results: calls.map(resultFor),
		}),
	});
	const result = await run();
	t.deepEqual(result, {
		kind: 'adapter-stop',
		payload: 'needs-approval',
		modelCalls: 1,
	});
	t.is(history().at(-1)?.role, 'tool');
});

test('onFinalAnswer can append messages and keep going', async t => {
	let asked = 0;
	const {run, requests} = setup([text('first'), text('second')], {
		onFinalAnswer: () =>
			asked++ === 0
				? {kind: 'continue', messages: [{role: 'user', content: 'more'}]}
				: {kind: 'finish'},
	});
	t.deepEqual(await run(), {kind: 'completed', modelCalls: 2});
	t.deepEqual(requests[1].at(-1), {role: 'user', content: 'more'});
});

test('a repeated-call stop names the valid calls it did not run', async t => {
	const {run} = setup([call('a'), call('a'), call('a')]);
	const result = await run();
	t.is(result.kind, 'guard-stop');
	if (result.kind === 'guard-stop') {
		t.is(result.guard, 'repeated-tool-calls');
		t.deepEqual(
			result.unrunToolCalls.map(c => c.id),
			['a'],
		);
	}
});

test('the max-turn ceiling ends the run when the final turn still calls tools', async t => {
	const {run, requests} = setup([call('a'), call('b')], {}, {maxTurns: 2});
	t.deepEqual(await run(), {kind: 'max-turns', maxTurns: 2, modelCalls: 2});
	t.regex(
		String(requests[1].at(-1)?.content),
		/maximum number of tool-execution turns/,
	);
});

test('a rejected call is reported to the adapter before history changes', async t => {
	let historyLength = -1;
	const {run, history} = setup(
		[
			{
				choices: [
					{
						message: {
							role: 'assistant',
							content: '',
							tool_calls: [{id: 'x', function: {name: 'nope', arguments: {}}}],
						},
					},
				],
			},
			text('done'),
		],
		{
			onRejectedToolCalls: () => {
				historyLength = history().length;
			},
		},
	);
	await run();
	t.is(historyLength, 1);
});

test('with the guards and text parsing off, any content-only reply finishes', async t => {
	const answers: string[] = [];
	const {run, history} = setup(
		[{...text('[tool_use: probe]'), toolsDisabled: true}],
		{
			onFinalAnswer: ({content}) => {
				answers.push(content);
				return {kind: 'finish'};
			},
		},
		{
			policy: {
				parseTextToolCalls: false,
				emptyTurnGuard: false,
				truncatedTurnGuard: false,
				repeatedToolCallGuard: false,
			},
		},
	);
	t.deepEqual(await run(), {kind: 'completed', modelCalls: 1});
	t.deepEqual(answers, ['[tool_use: probe]']);
	t.is(history().at(-1)?.content, '[tool_use: probe]');
});

test('an empty reply finishes when the empty-turn guard is off', async t => {
	const {run} = setup([text('')], {}, {policy: {emptyTurnGuard: false}});
	t.deepEqual(await run(), {kind: 'completed', modelCalls: 1});
});

test('the repeated-call guard can be switched off', async t => {
	const {run} = setup(
		[call('a'), call('a'), call('a'), text('done')],
		{},
		{policy: {repeatedToolCallGuard: false}},
	);
	t.deepEqual(await run(), {kind: 'completed', modelCalls: 4});
});

test('onToolCallsEmitted runs before the turn is recorded, onTurnRecorded after', async t => {
	const seen: Array<[string, number]> = [];
	const {run, history} = setup([call('a'), text('done')], {
		onToolCallsEmitted: calls => {
			seen.push([`emitted:${calls.length}`, history().length]);
		},
		onTurnRecorded: () => {
			seen.push(['recorded', history().length]);
		},
	});
	await run();
	t.deepEqual(seen, [
		['emitted:1', 1],
		['recorded', 2],
		['recorded', 4],
	]);
});

test('a throw from an adapter hook ends the run with that error', async t => {
	const {run} = setup([call('a')], {
		onToolCallsEmitted: () => {
			throw new Error('stuck');
		},
	});
	await t.throwsAsync(run(), {message: 'stuck'});
});
