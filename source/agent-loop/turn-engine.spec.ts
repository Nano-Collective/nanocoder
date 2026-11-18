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
				textToolCalls: 'off',
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

test('onAssistantTurn runs before the turn is recorded, onTurnRecorded after', async t => {
	const seen: Array<[string, number]> = [];
	const {run, history} = setup([call('a'), text('done')], {
		onAssistantTurn: ({toolCalls}) => {
			seen.push([`emitted:${toolCalls.length}`, history().length]);
		},
		onTurnRecorded: () => {
			seen.push(['recorded', history().length]);
		},
	});
	await run();
	t.deepEqual(seen, [
		['emitted:1', 1],
		['recorded', 2],
		['emitted:0', 3],
		['recorded', 4],
	]);
});

test('a throw from an adapter hook ends the run with that error', async t => {
	const {run} = setup([call('a')], {
		onAssistantTurn: () => {
			throw new Error('stuck');
		},
	});
	await t.throwsAsync(run(), {message: 'stuck'});
});

// --- Options and hooks the interactive TUI needs ---

const XML_PROBE = '<probe>\n  <id>x</id>\n</probe>';

const executedIds = (history: Message[]) =>
	history.filter(m => m.role === 'tool').map(m => m.tool_call_id);

test('fallback parsing leaves text tool calls on a native turn alone', async t => {
	const {run, history} = setup([text(XML_PROBE)]);
	t.deepEqual(await run(), {kind: 'completed', modelCalls: 1});
	t.deepEqual(executedIds(history()), []);
});

test('whenever-no-native parses text tool calls on a native turn', async t => {
	const {run, history} = setup(
		[text(XML_PROBE), text('done')],
		{},
		{policy: {textToolCalls: 'whenever-no-native'}},
	);
	t.deepEqual(await run(), {kind: 'completed', modelCalls: 2});
	const assistant = history().find(m => m.role === 'assistant');
	t.is(assistant?.tool_calls?.[0]?.function.name, 'probe');
	t.is(executedIds(history()).length, 1);
});

test('whenever-no-native strips tool-call text echoed beside native calls', async t => {
	const echoed: Reply = {
		choices: [
			{
				message: {
					role: 'assistant',
					content: `Reading it.\n${XML_PROBE}`,
					tool_calls: [{id: 'a', function: {name: 'probe', arguments: {}}}],
				},
			},
		],
	};
	const {run, history} = setup(
		[echoed, text('done')],
		{},
		{policy: {textToolCalls: 'whenever-no-native'}},
	);
	await run();
	const assistant = history().find(m => m.role === 'assistant');
	t.is(String(assistant?.content).trim(), 'Reading it.');
	t.deepEqual(executedIds(history()), ['a']);
});

const OPEN_PROBE = '<probe>\n  <id>x</id>\n';

test('a text tool call left open is retried as malformed, for offered tools only', async t => {
	const errors: string[] = [];
	const onMalformedRetry = ({error}: {error: string}) => {
		errors.push(error);
	};
	const offered = setup(
		[{...text(OPEN_PROBE), toolsDisabled: true}, text('done')],
		{onMalformedRetry},
	);
	t.deepEqual(await offered.run(), {kind: 'completed', modelCalls: 2});
	t.deepEqual(errors, [
		'Incomplete tool call: <probe> is never closed with </probe>',
	]);

	// Not offered this turn, so the reply is plain text as before.
	const notOffered = setup([{...text(OPEN_PROBE), toolsDisabled: true}], {
		onMalformedRetry,
		prepareTurn: () => ({tools: {}, availableNames: []}),
	});
	t.deepEqual(await notOffered.run(), {kind: 'completed', modelCalls: 1});
	t.is(errors.length, 1);
});

test('whenever-no-native checks a text tool call left open on a native turn', async t => {
	const errors: string[] = [];
	const {run} = setup(
		[text(OPEN_PROBE), text('done')],
		{
			onMalformedRetry: ({error}) => {
				errors.push(error);
			},
		},
		{policy: {textToolCalls: 'whenever-no-native'}},
	);
	t.deepEqual(await run(), {kind: 'completed', modelCalls: 2});
	t.deepEqual(errors, [
		'Incomplete tool call: <probe> is never closed with </probe>',
	]);
});

test('stripThinkTags drops think blocks from the recorded text', async t => {
	const answers: string[] = [];
	const {run} = setup(
		[text('<think>pondering</think>The answer.')],
		{
			onFinalAnswer: ({content}) => {
				answers.push(content);
				return {kind: 'finish'};
			},
		},
		{policy: {stripThinkTags: true}},
	);
	await run();
	t.deepEqual(answers, ['The answer.']);
});

test('maxToolCallsPerTurn keeps only the first calls', async t => {
	const twoCalls: Reply = {
		choices: [
			{
				message: {
					role: 'assistant',
					content: '',
					tool_calls: [
						{id: 'a', function: {name: 'probe', arguments: {}}},
						{id: 'b', function: {name: 'probe', arguments: {}}},
					],
				},
			},
		],
	};
	const {run, history} = setup(
		[twoCalls, text('done')],
		{},
		{policy: {maxToolCallsPerTurn: 1}},
	);
	await run();
	t.deepEqual(executedIds(history()), ['a']);
});

test('repeatSignature emitted ignores calls that never reach history', async t => {
	// A call with no id is dropped by the partition. Keyed on every emitted
	// call it breaks the streak; keyed on the recorded calls it does not.
	const withStray: Reply = {
		choices: [
			{
				message: {
					role: 'assistant',
					content: '',
					tool_calls: [
						{id: 'a', function: {name: 'probe', arguments: {id: 'a'}}},
						{id: '', function: {name: 'probe', arguments: {}}},
					],
				},
			},
		],
	};
	const replies = () => [call('a'), withStray, call('a'), text('done')];

	const all = await setup(replies()).run();
	t.is(all.kind, 'completed');

	const emitted = await setup(
		replies(),
		{},
		{policy: {repeatSignature: 'emitted'}},
	).run();
	t.is(emitted.kind, 'guard-stop');
});

test('with abortBetweenTurns off, the model call raises the abort', async t => {
	const controller = new AbortController();
	controller.abort();
	const {run, requests} = setup(
		[new Error('This operation was aborted')],
		{},
		{signal: controller.signal, policy: {abortBetweenTurns: false}},
	);
	const result = await run();
	t.is(requests.length, 1);
	t.is(result.kind, 'aborted');
	if (result.kind === 'aborted') {
		t.is((result.error as Error).message, 'This operation was aborted');
	}
});

test('emptyTurnNudge words the nudge, and onEmptyRetry is told it', async t => {
	const retries: Array<[number, string]> = [];
	const {run, requests} = setup([text(''), text('done')], {
		emptyTurnNudge: history => `nudge after ${history.length}`,
		onEmptyRetry: (attempt, nudge) => {
			retries.push([attempt, nudge]);
		},
	});
	await run();
	t.deepEqual(retries, [[1, 'nudge after 1']]);
	t.deepEqual(requests[1].at(-1), {role: 'user', content: 'nudge after 1'});
});

test('onEmptyTurnsExhausted can replace history and reset the guards', async t => {
	let exhausted = 0;
	const {run, history} = setup(
		// Default maxEmptyTurns = 2: three empties hit the cap, the replacement
		// history buys another three.
		[text(''), text(''), text(''), text(''), text(''), text('done')],
		{
			onEmptyTurnsExhausted: async () => {
				exhausted++;
				return exhausted === 1
					? [{role: 'user', content: 'compacted, carry on'}]
					: undefined;
			},
		},
	);
	t.deepEqual(await run(), {kind: 'completed', modelCalls: 6});
	t.is(exhausted, 1);
	t.is(history()[0].content, 'compacted, carry on');
});

test('onEmptyTurnsExhausted returning nothing stops at the cap', async t => {
	const {run} = setup([text(''), text(''), text('')], {
		onEmptyTurnsExhausted: async () => undefined,
	});
	const result = await run();
	t.is(result.kind, 'guard-stop');
	if (result.kind === 'guard-stop') t.is(result.guard, 'empty');
});

test('onRepeatedToolCalls continue grants a fresh window and counts the total', async t => {
	const asked: Array<{total: number; unrun: string[]}> = [];
	const {run, history} = setup(
		[call('a'), call('a'), call('a'), call('a'), call('a'), call('a')],
		{
			onRepeatedToolCalls: async info => {
				asked.push({
					total: info.total,
					unrun: info.unrunToolCalls.map(c => c.id),
				});
				return asked.length === 1 ? 'continue' : 'stop';
			},
		},
	);
	const result = await run();
	t.is(result.kind, 'guard-stop');
	// Asked at the 3rd identical turn, then again 3 turns later (the 6th).
	t.deepEqual(asked, [
		{total: 3, unrun: ['a']},
		{total: 6, unrun: ['a']},
	]);
	// The granted 3rd call ran, and so did the 4th and 5th.
	t.is(executedIds(history()).length, 5);
});

test('a final-answer continue can reset the retry guards', async t => {
	const replies = () => [
		call('a'),
		call('a'),
		text('summary'),
		call('a'),
		text('done'),
	];
	const onFinalAnswer =
		(resetRetryGuards: boolean) =>
		({content}: {content: string}) =>
			content === 'summary'
				? {
						kind: 'continue' as const,
						messages: [{role: 'user' as const, content: 'one more'}],
						resetRetryGuards,
					}
				: {kind: 'finish' as const};

	const kept = await setup(replies(), {onFinalAnswer: onFinalAnswer(false)}).run();
	t.is(kept.kind, 'guard-stop', 'the streak survives a plain nudge');

	const reset = await setup(replies(), {onFinalAnswer: onFinalAnswer(true)}).run();
	t.is(reset.kind, 'completed');
});

test('tool outcome messages are recorded right after the results, in one write', async t => {
	let messages: Message[] = [{role: 'user', content: 'go'}];
	const writes: string[][] = [];
	const {run} = setup([call('a'), text('done')], {
		history: {
			get: () => messages,
			set: next => {
				writes.push(next.slice(messages.length).map(m => m.role));
				messages = next;
			},
		},
		executeTools: async calls => ({
			kind: 'continue',
			results: calls.map(resultFor),
			messages: [{role: 'user', content: 'diagnostics'}],
		}),
	});
	await run();
	t.deepEqual(writes, [['assistant'], ['tool', 'user'], ['assistant']]);
	t.is(messages[3].content, 'diagnostics');
});

test('onTurnRecorded is told the recorded assistant message', async t => {
	const recorded: Array<{content?: string; compacted: boolean}> = [];
	const {run} = setup([text('')], {
		onTurnRecorded: ({assistantMessage, compacted}) => {
			recorded.push({content: assistantMessage?.content, compacted});
		},
	}, {policy: {emptyTurnGuard: false}});
	await run();
	// An empty turn records nothing.
	t.deepEqual(recorded, [{content: undefined, compacted: false}]);
});

test('toolResultMessages shapes every tool result written to history', async t => {
	const unknown: Reply = {
		choices: [
			{
				message: {
					role: 'assistant',
					content: '',
					tool_calls: [{id: 'x', function: {name: 'nope', arguments: {}}}],
				},
			},
		],
	};
	const {run, history} = setup([call('a'), unknown, text('done')], {
		toolResultMessages: results =>
			results.map(result => ({
				role: 'tool' as const,
				content: `shaped: ${result.content}`,
				tool_call_id: result.tool_call_id,
				name: result.name,
			})),
	});
	await run();
	const tools = history().filter(m => m.role === 'tool');
	t.deepEqual(
		tools.map(m => m.content),
		['shaped: ok', 'shaped: Unknown tool: nope'],
	);
});

test('onEmptyRetry is awaited before the nudge is recorded', async t => {
	const order: string[] = [];
	let historyAtRetry = -1;
	const {run, history} = setup([text(''), text('done')], {
		onEmptyRetry: async () => {
			await new Promise(resolve => setTimeout(resolve, 5));
			historyAtRetry = history().length;
			order.push('retry');
		},
	});
	await run();
	t.deepEqual(order, ['retry']);
	t.is(historyAtRetry, 1);
	t.is(history()[1].role, 'user');
});
