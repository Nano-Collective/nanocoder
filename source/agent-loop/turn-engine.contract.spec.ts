import {randomUUID} from 'node:crypto';
import type {AgentSideConnection} from '@agentclientprotocol/sdk';
import test from 'ava';
import {runAcpConversation} from '@/acp/acp-conversation';
import {NO_RESPONSE_MESSAGE} from '@/agent-loop/turn-engine';
import {AcpSession} from '@/acp/acp-session';
import {reloadAppConfig} from '@/config/index';
import {
	EMPTY_TURN_NUDGE,
	TRUNCATED_TURN_INSTRUCTION,
} from '@/hooks/chat-handler/utils/headless-retry-guards';
import {setToolManagerGetter, setToolRegistryGetter} from '@/message-handler';
import {runPlainConversation} from '@/plain/conversation';
import {processAssistantResponse} from '@/hooks/chat-handler/conversation/conversation-loop';
import {SubagentExecutor} from '@/subagents/subagent-executor';
import {getSubagentLoader} from '@/subagents/subagent-loader';
import type {ToolManager} from '@/tools/tool-manager';
import {setGlobalToolApprovalHandler} from '@/tools/runtime/tool-approval-queue';
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
// instead of drifting silently. All four frontends run on the shared turn
// engine (source/agent-loop/turn-engine.ts); where the interactive TUI is
// deliberately different, its runner says so and the scenario asserts what
// it does instead.

process.env.NO_COLOR = '1';

type Reply = Partial<LLMChatResponse>;

interface Observation {
	end: 'completed' | 'stopped' | 'cancelled';
	/** Why a run that did not complete stopped, as the frontend reports it. */
	failure?: string;
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
		chat: async (
			messages: Message[],
			tools: Record<string, unknown>,
			_callbacks: unknown,
			signal?: AbortSignal,
		) => {
			// A real client raises the abort instead of sending the request.
			if (signal?.aborted) throw new Error('Operation was cancelled');
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
		// What the subagent executor reads.
		getAllTools: () => Object.fromEntries(TOOLS.map(name => [name, {}])),
		getToolHandler: (name: string) =>
			TOOLS.includes(name) ? probeHandler : undefined,
		filterToolNamesForMode: (names: string[]) => names,
		getOwnerSkill: () => undefined,
		getToolFormatter: () => undefined,
		getStreamingFormatter: () => undefined,
	} as unknown as ToolManager;
}

// The run in progress, so the tool registry can record what executed.
let active: Observation | undefined;

const probeHandler = async () => {
	active?.executed.push('probe');
	return 'probed';
};

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
	if (outcome.kind === 'error') observation.failure = outcome.message;
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
	let response: Awaited<ReturnType<typeof runAcpConversation>>;
	try {
		response = await runAcpConversation({
			session,
			client: makeClient(scenario.replies, observation),
			toolManager: makeToolManager(),
			conn,
			nonInteractiveAlwaysAllow: [],
		});
	} catch (error) {
		// A failed prompt request reaches the client as an error response.
		observation.end = 'stopped';
		observation.failure = (error as Error).message;
		return observation;
	}
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

const subagentRunner: Runner = async scenario => {
	const observation = newObservation();
	const controller = new AbortController();
	if (scenario.abortBeforeStart) controller.abort();
	const executor = new SubagentExecutor(
		makeToolManager(),
		makeClient(scenario.replies, observation),
	);
	const result = await executor.execute(
		{subagent_type: 'explore', description: 'go'},
		controller.signal,
		0,
		undefined,
		undefined,
		{tools: TOOLS},
	);
	observation.failure = result.error;
	observation.end = result.success
		? 'completed'
		: result.error === 'Aborted'
			? 'cancelled'
			: 'stopped';
	return observation;
};

// The interactive loop, run non-interactively (nobody to ask) in auto-accept.
const tuiRunner: Runner = async scenario => {
	const observation = newObservation();
	const controller = new AbortController();
	if (scenario.abortBeforeStart) controller.abort();
	const queue: unknown[] = [];
	try {
		await processAssistantResponse({
			systemMessage: {role: 'system', content: 'sys'},
			messages: [{role: 'user', content: 'go'}],
			client: makeClient(scenario.replies, observation),
			toolManager: makeToolManager(),
			abortController: controller,
			setAbortController: () => {},
			setIsGenerating: () => {},
			setStreamingReasoning: () => {},
			setStreamingContent: () => {},
			setTokenCount: () => {},
			setMessages: () => {},
			addToChatQueue: (item: unknown) => queue.push(item),
			currentProvider: 'openai',
			currentModel: 'fake-model',
			developmentMode: 'auto-accept',
			nonInteractiveMode: true,
			conversationStateManager: {
				current: {
					updateAssistantMessage: () => {},
					updateAfterToolExecution: () => {},
				},
			},
		} as never);
	} catch (error) {
		// Errors, and the abort, unwind to the caller (useChatHandler).
		observation.failure = (error as Error).message;
		observation.end = controller.signal.aborted ? 'cancelled' : 'stopped';
		return observation;
	}
	// A finished run ends with the completion note; a stopped one with the
	// error that says why.
	const last = queue[queue.length - 1] as
		| {key?: unknown; props?: {message?: unknown}}
		| undefined;
	if (String(last?.key).includes('completion-time')) {
		observation.end = 'completed';
	} else {
		observation.end = 'stopped';
		observation.failure = String(last?.props?.message ?? '');
	}
	return observation;
};

interface FrontendUnderTest {
	name: string;
	run: Runner;
	/** The result an unknown tool gets. */
	unknownToolResult: RegExp;
	/**
	 * Headless loops cap the turns and spend the last one on a tool-free
	 * answer. The TUI has no ceiling: the user is there to stop it.
	 */
	turnCeiling: boolean;
	/**
	 * Headless loops ask a reply cut off at the output limit to continue. The
	 * TUI shows the fragment and hands back to the user.
	 */
	continuesTruncation: boolean;
	/**
	 * At the empty-turn cap the TUI compacts the context once and tries again
	 * before giving up; headless loops stop.
	 */
	compactsAtEmptyCap: boolean;
}

const frontends: FrontendUnderTest[] = [
	{
		name: 'plain',
		run: plainRunner,
		unknownToolResult: /^Unknown tool: nope$/,
		turnCeiling: true,
		continuesTruncation: true,
		compactsAtEmptyCap: false,
	},
	{
		name: 'acp',
		run: acpRunner,
		unknownToolResult: /^Unknown tool: nope$/,
		turnCeiling: true,
		continuesTruncation: true,
		compactsAtEmptyCap: false,
	},
	{
		name: 'subagent',
		run: subagentRunner,
		unknownToolResult: /'nope' is not available to this subagent/,
		turnCeiling: true,
		continuesTruncation: true,
		compactsAtEmptyCap: false,
	},
	{
		name: 'tui',
		run: tuiRunner,
		unknownToolResult: /^The tool "nope" does not exist/,
		turnCeiling: false,
		continuesTruncation: false,
		compactsAtEmptyCap: true,
	},
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

test.before(async () => {
	await getSubagentLoader().initialize();
	// A subagent asks the parent's approval handler; approve, as auto-accept.
	setGlobalToolApprovalHandler(async () => true);
});

test.beforeEach(() => {
	setToolManagerGetter(() => null);
	setToolRegistryGetter(() => ({
		probe: probeHandler,
	}));
});

test.afterEach.always(() => {
	delete process.env.NANOCODER_MAX_TURNS;
	reloadAppConfig();
});

for (const {
	name,
	run,
	unknownToolResult,
	turnCeiling,
	continuesTruncation,
	compactsAtEmptyCap,
} of frontends) {
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

	test.serial(`[${name}] a reply with no choices is an error`, async t => {
		const seen = await run({replies: [{choices: []}]});
		t.is(seen.end, 'stopped');
		t.is(seen.failure, NO_RESPONSE_MESSAGE);
		t.is(seen.requests.length, 1);
	});

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
		const seen = await run({replies: Array.from({length: 6}, () => text(''))});
		t.is(seen.end, 'stopped');
		if (compactsAtEmptyCap) {
			// One compact-and-retry (MAX_COMPACT_RETRIES = 1) buys three more.
			t.is(seen.requests.length, 6);
			t.regex(
				String(lastOf(seen.requests[3])?.content),
				/Context has been compacted/,
			);
			t.regex(seen.failure ?? '', /no output after 4 attempts/);
			return;
		}
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
			t.regex(String(result?.content), unknownToolResult);
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
		if (!continuesTruncation) {
			t.is(seen.requests.length, 1);
			return;
		}
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
			if (!turnCeiling) {
				t.deepEqual(seen.offered, [TOOLS, TOOLS]);
				return;
			}
			t.deepEqual(seen.offered, [TOOLS, []]);
			t.regex(
				String(lastOf(seen.requests[1])?.content),
				/maximum number of tool-execution turns/,
			);
		},
	);
}
