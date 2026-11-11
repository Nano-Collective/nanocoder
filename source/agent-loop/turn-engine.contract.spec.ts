import {randomUUID} from 'node:crypto';
import type {AgentSideConnection} from '@agentclientprotocol/sdk';
import test from 'ava';
import {runAcpConversation} from '@/acp/acp-conversation';
import {AcpSession} from '@/acp/acp-session';
import {reloadAppConfig} from '@/config/index';
import {
	EMPTY_TURN_NUDGE,
	TRUNCATED_TURN_INSTRUCTION,
} from '@/hooks/chat-handler/utils/headless-retry-guards';
import {setToolManagerGetter, setToolRegistryGetter} from '@/message-handler';
import {runPlainConversation} from '@/plain/conversation';
import type {ToolManager} from '@/tools/tool-manager';
import type {
	AISDKCoreTool,
	LLMChatResponse,
	LLMClient,
	Message,
	ToolCall,
	ToolEntry,
	ToolHandler,
} from '@/types/core';

// One set of scenarios, run through every frontend that drives the agent
// loop. Each runner reduces its frontend's outcome to the same observation,
// so a guard or retry that one loop gets and another does not fails here
// instead of drifting silently. Frontends join as they move onto the shared
// turn engine (source/agent-loop/turn-engine.ts); ACP is covered already so
// its migration is checked against the behaviour it has today.

process.env.NO_COLOR = '1';

type Reply = Partial<LLMChatResponse>;

interface Observation {
	end: 'completed' | 'stopped' | 'cancelled';
	/** History sent on each model call, system message excluded. */
	requests: Message[][];
	/** Tool names offered on each model call. */
	offered: string[][];
	/** Tool names that actually ran, in order. */
	executed: string[];
}

interface Scenario {
	replies: Reply[];
	abortBeforeStart?: boolean;
}

type Runner = (scenario: Scenario) => Promise<Observation>;

const TOOLS = ['probe'];

function makeClient(replies: Reply[], observation: Observation): LLMClient {
	let index = 0;
	return {
		getCurrentModel: () => 'fake-model',
		getProviderConfig: () => ({}) as never,
		getContextSize: () => 100_000,
		chat: async (messages: Message[], tools: Record<string, unknown>) => {
			observation.requests.push(messages.filter(m => m.role !== 'system'));
			observation.offered.push(Object.keys(tools));
			const reply = replies[index++];
			if (!reply) throw new Error('scripted client ran out of replies');
			return {
				choices: reply.choices ?? [{message: {role: 'assistant', content: ''}}],
				toolsDisabled: reply.toolsDisabled,
				finishReason: reply.finishReason,
				usage: reply.usage,
			} as LLMChatResponse;
		},
	} as unknown as LLMClient;
}

function makeToolManager(): ToolManager {
	return {
		getAvailableToolNames: () => [...TOOLS],
		getFilteredTools: (names: string[]) =>
			Object.fromEntries(names.map(name => [name, {} as AISDKCoreTool])),
		hasTool: (name: string) => TOOLS.includes(name),
		getToolNames: () => [...TOOLS],
		getToolEntry: (name: string): ToolEntry | undefined =>
			TOOLS.includes(name)
				? {
						name,
						tool: {} as AISDKCoreTool,
						handler: (async () => 'ok') as ToolHandler,
						approval: false,
					}
				: undefined,
		getToolValidator: () => undefined,
		isReadOnly: () => true,
	} as unknown as ToolManager;
}

// The run in progress, so the tool registry can record what executed.
let active: Observation | undefined;

const newObservation = (): Observation => {
	active = {end: 'completed', requests: [], offered: [], executed: []};
	return active;
};

const plainRunner: Runner = async scenario => {
	const observation = newObservation();
	const controller = new AbortController();
	if (scenario.abortBeforeStart) controller.abort();
	const outcome = await runPlainConversation({
		client: makeClient(scenario.replies, observation),
		toolManager: makeToolManager(),
		systemMessage: {role: 'system', content: 'sys'},
		initialMessages: [{role: 'user', content: 'go'}],
		developmentMode: 'auto-accept',
		nonInteractiveAlwaysAllow: [],
		abortSignal: controller.signal,
		outputFormat: 'json',
	});
	observation.end =
		outcome.kind === 'success'
			? 'completed'
			: outcome.kind === 'error' && outcome.message === 'Aborted'
				? 'cancelled'
				: 'stopped';
	return observation;
};

const acpRunner: Runner = async scenario => {
	const observation = newObservation();
	const conn = {
		sessionUpdate: async () => {},
		requestPermission: async () => ({
			outcome: {outcome: 'selected', optionId: 'allow'},
		}),
	} as unknown as AgentSideConnection;
	const session = new AcpSession({
		sessionId: randomUUID(),
		cwd: '/tmp',
		conn,
		initialMode: 'auto-accept',
	});
	session.systemMessage = {role: 'system', content: 'sys'};
	session.messages = [{role: 'user', content: 'go'}];
	if (scenario.abortBeforeStart) session.abortController.abort();
	const response = await runAcpConversation({
		session,
		client: makeClient(scenario.replies, observation),
		toolManager: makeToolManager(),
		conn,
		nonInteractiveAlwaysAllow: [],
	});
	// A run stopped by a guard ends with a display-only notice in history.
	const last = session.messages[session.messages.length - 1];
	observation.end =
		response.stopReason === 'cancelled'
			? 'cancelled'
			: response.stopReason === 'end_turn' && !last?.displayOnly
				? 'completed'
				: 'stopped';
	return observation;
};

const runners: Array<[string, Runner]> = [
	['plain', plainRunner],
	['acp', acpRunner],
];

const text = (content: string): Reply => ({
	choices: [{message: {role: 'assistant', content}}],
});
const call = (name: string, id = `call-${name}`): Reply => ({
	choices: [
		{
			message: {
				role: 'assistant',
				content: '',
				tool_calls: [{id, function: {name, arguments: {}}} as ToolCall],
			},
		},
	],
});
const lastOf = (messages: Message[] | undefined) =>
	messages?.[messages.length - 1];

test.beforeEach(() => {
	setToolManagerGetter(() => null);
	setToolRegistryGetter(() => ({
		probe: async () => {
			active?.executed.push('probe');
			return 'probed';
		},
	}));
});

test.afterEach.always(() => {
	delete process.env.NANOCODER_MAX_TURNS;
	reloadAppConfig();
});

for (const [name, run] of runners) {
	test.serial(`[${name}] a content-only reply ends the run`, async t => {
		const seen = await run({replies: [text('done')]});
		t.is(seen.end, 'completed');
		t.is(seen.requests.length, 1);
		t.deepEqual(seen.offered[0], TOOLS);
		t.deepEqual(seen.executed, []);
	});

	test.serial(
		`[${name}] runs an auto-approved call and feeds its result back`,
		async t => {
			const seen = await run({replies: [call('probe'), text('done')]});
			t.is(seen.end, 'completed');
			t.is(seen.requests.length, 2);
			t.deepEqual(seen.executed, ['probe']);
			const result = lastOf(seen.requests[1]);
			t.is(result?.role, 'tool');
			t.is(result?.tool_call_id, 'call-probe');
		},
	);

	test.serial(`[${name}] nudges an empty turn, then recovers`, async t => {
		const seen = await run({replies: [text(''), text('done')]});
		t.is(seen.end, 'completed');
		t.deepEqual(lastOf(seen.requests[1]), {
			role: 'user',
			content: EMPTY_TURN_NUDGE,
		});
		// The empty assistant turn itself is never recorded.
		t.false(seen.requests[1].some(m => m.role === 'assistant'));
	});

	test.serial(`[${name}] stops after the empty-turn cap`, async t => {
		// Default maxEmptyTurns = 2: the first empty reply plus two nudges.
		const seen = await run({replies: [text(''), text(''), text('')]});
		t.is(seen.end, 'stopped');
		t.is(seen.requests.length, 3);
	});

	test.serial(
		`[${name}] asks the model to fix a malformed text tool call`,
		async t => {
			const seen = await run({
				replies: [
					{...text('[tool_use: probe]'), toolsDisabled: true},
					text('done'),
				],
			});
			t.is(seen.end, 'completed');
			const [assistant, nudge] = seen.requests[1].slice(-2);
			t.deepEqual(assistant, {
				role: 'assistant',
				content: '[tool_use: probe]',
			});
			t.regex(String(nudge.content), /malformed tool call/);
		},
	);

	test.serial(
		`[${name}] answers an unknown tool with an error result`,
		async t => {
			const seen = await run({replies: [call('nope'), text('done')]});
			t.is(seen.end, 'completed');
			t.deepEqual(seen.executed, []);
			const result = lastOf(seen.requests[1]);
			t.is(result?.role, 'tool');
			t.is(result?.content, 'Unknown tool: nope');
		},
	);

	test.serial(
		`[${name}] stops a repeated identical call before running the repeat`,
		async t => {
			// Default maxRepeatedToolCalls = 3: the third repeat is not run.
			const seen = await run({
				replies: [call('probe'), call('probe'), call('probe')],
			});
			t.is(seen.end, 'stopped');
			t.is(seen.requests.length, 3);
			t.deepEqual(seen.executed, ['probe', 'probe']);
			// Two runs fed back, one result each.
			t.is(seen.requests[2].filter(m => m.role === 'tool').length, 2);
		},
	);

	test.serial(`[${name}] continues a truncated reply`, async t => {
		const seen = await run({
			replies: [{...text('half a'), finishReason: 'length'}, text('done')],
		});
		t.is(seen.end, 'completed');
		const [fragment, nudge] = seen.requests[1].slice(-2);
		t.is(fragment.content, 'half a');
		t.deepEqual(nudge, {role: 'user', content: TRUNCATED_TURN_INSTRUCTION});
	});

	test.serial(`[${name}] an abort before the first turn calls nothing`, async t => {
		const seen = await run({replies: [], abortBeforeStart: true});
		t.is(seen.end, 'cancelled');
		t.is(seen.requests.length, 0);
	});

	test.serial(
		`[${name}] the last allowed turn offers no tools and asks for an answer`,
		async t => {
			process.env.NANOCODER_MAX_TURNS = '2';
			reloadAppConfig();
			const seen = await run({replies: [call('probe'), text('done')]});
			t.is(seen.end, 'completed');
			t.deepEqual(seen.executed, ['probe']);
			t.deepEqual(seen.offered, [TOOLS, []]);
			t.regex(
				String(lastOf(seen.requests[1])?.content),
				/maximum number of tool-execution turns/,
			);
		},
	);
}
