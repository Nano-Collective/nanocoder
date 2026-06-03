import test from 'ava';
import {setToolManagerGetter, setToolRegistryGetter} from '@/message-handler';
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
import {runPlainConversation} from './conversation.js';

// Suppress ANSI in test output so tokens streamed to stdout stay readable.
process.env.NO_COLOR = '1';

interface FakeClientOptions {
	responses: Array<Partial<LLMChatResponse>>;
}

function makeFakeClient(options: FakeClientOptions): LLMClient {
	let callIndex = 0;
	return {
		getCurrentModel: () => 'fake-model',
		setModel: () => undefined,
		getContextSize: () => 100_000,
		getAvailableModels: async () => ['fake-model'],
		getProviderConfig: () => ({} as never),
		clearContext: async () => undefined,
		getTimeout: () => undefined,
		chat: async () => {
			const partial = options.responses[callIndex++];
			if (!partial) {
				throw new Error('FakeClient ran out of canned responses');
			}
			return {
				choices: partial.choices ?? [{message: {role: 'assistant', content: ''}}],
				toolsDisabled: partial.toolsDisabled,
			} as LLMChatResponse;
		},
	} as unknown as LLMClient;
}

interface FakeToolManagerOptions {
	knownTools?: Set<string>;
	needsApprovalByName?: Record<string, boolean>;
}

function makeFakeToolManager(opts: FakeToolManagerOptions = {}): ToolManager {
	const known = opts.knownTools ?? new Set<string>();
	const approvals = opts.needsApprovalByName ?? {};
	return {
		getAvailableToolNames: () => Array.from(known),
		getFilteredTools: () => ({}) as Record<string, AISDKCoreTool>,
		hasTool: (name: string) => known.has(name),
		getToolEntry: (name: string): ToolEntry | undefined => {
			if (!known.has(name)) return undefined;
			return {
				name,
				tool: {} as unknown as AISDKCoreTool,
				handler: (async () => 'ok') as ToolHandler,
				approval: approvals[name] ?? false,
			};
		},
		getToolValidator: () => undefined,
	} as unknown as ToolManager;
}

const SYSTEM: Message = {role: 'system', content: 'sys'};
const USER: Message = {role: 'user', content: 'hi'};

test.beforeEach(() => {
	setToolRegistryGetter(() => ({}));
	setToolManagerGetter(() => null);
});

test('returns success when model emits content and no tool calls', async t => {
	const client = makeFakeClient({
		responses: [
			{
				choices: [{message: {role: 'assistant', content: 'hello world'}}],
			},
		],
	});
	const toolManager = makeFakeToolManager();

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: 'auto-accept',
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, 'success');
});

test('returns error when model emits empty response with no tool calls', async t => {
	const client = makeFakeClient({
		responses: [
			{
				choices: [{message: {role: 'assistant', content: ''}}],
			},
		],
	});
	const toolManager = makeFakeToolManager();

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: 'auto-accept',
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, 'error');
	if (outcome.kind === 'error') {
		t.regex(outcome.message, /empty response/i);
	}
});

test('executes a tool call that does not need approval and recurses to success', async t => {
	const toolCall: ToolCall = {
		id: 'call-1',
		function: {name: 'safe_tool', arguments: {}},
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: 'assistant',
							content: '',
							tool_calls: [toolCall],
						},
					},
				],
			},
			{
				choices: [{message: {role: 'assistant', content: 'all done'}}],
			},
		],
	});
	const toolManager = makeFakeToolManager({
		knownTools: new Set(['safe_tool']),
		needsApprovalByName: {safe_tool: false},
	});
	let handlerCalls = 0;
	setToolRegistryGetter(() => ({
		safe_tool: (async () => {
			handlerCalls++;
			return 'tool-output';
		}) as ToolHandler,
	}));

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: 'auto-accept',
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, 'success');
	t.is(handlerCalls, 1);
});

test('returns tool-approval-required when a tool needs approval and mode is not yolo', async t => {
	const toolCall: ToolCall = {
		id: 'call-1',
		function: {name: 'risky_tool', arguments: {}},
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: 'assistant',
							content: '',
							tool_calls: [toolCall],
						},
					},
				],
			},
		],
	});
	const toolManager = makeFakeToolManager({
		knownTools: new Set(['risky_tool']),
		needsApprovalByName: {risky_tool: true},
	});

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: 'auto-accept',
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, 'tool-approval-required');
	if (outcome.kind === 'tool-approval-required') {
		t.deepEqual(outcome.toolNames, ['risky_tool']);
	}
});

test('yolo mode bypasses needsApproval and executes the tool', async t => {
	const toolCall: ToolCall = {
		id: 'call-1',
		function: {name: 'risky_tool', arguments: {}},
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: 'assistant',
							content: '',
							tool_calls: [toolCall],
						},
					},
				],
			},
			{
				choices: [{message: {role: 'assistant', content: 'done'}}],
			},
		],
	});
	const toolManager = makeFakeToolManager({
		knownTools: new Set(['risky_tool']),
		needsApprovalByName: {risky_tool: true},
	});
	let handlerCalls = 0;
	setToolRegistryGetter(() => ({
		risky_tool: (async () => {
			handlerCalls++;
			return 'tool-output';
		}) as ToolHandler,
	}));

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: 'yolo',
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, 'success');
	t.is(handlerCalls, 1);
});

test('alwaysAllow list bypasses needsApproval', async t => {
	const toolCall: ToolCall = {
		id: 'call-1',
		function: {name: 'risky_tool', arguments: {}},
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: 'assistant',
							content: '',
							tool_calls: [toolCall],
						},
					},
				],
			},
			{
				choices: [{message: {role: 'assistant', content: 'done'}}],
			},
		],
	});
	const toolManager = makeFakeToolManager({
		knownTools: new Set(['risky_tool']),
		needsApprovalByName: {risky_tool: true},
	});
	setToolRegistryGetter(() => ({
		risky_tool: (async () => 'ok') as ToolHandler,
	}));

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: 'auto-accept',
		nonInteractiveAlwaysAllow: ['risky_tool'],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, 'success');
});

test('unknown tool produces an error result that is fed back to the model', async t => {
	const toolCall: ToolCall = {
		id: 'call-1',
		function: {name: 'no_such_tool', arguments: {}},
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: 'assistant',
							content: '',
							tool_calls: [toolCall],
						},
					},
				],
			},
			{
				choices: [{message: {role: 'assistant', content: 'recovered'}}],
			},
		],
	});
	const toolManager = makeFakeToolManager(); // no known tools

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: 'auto-accept',
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, 'success');
});

test('aborted signal short-circuits with an error outcome', async t => {
	const client = makeFakeClient({
		responses: [
			{choices: [{message: {role: 'assistant', content: 'should not run'}}]},
		],
	});
	const toolManager = makeFakeToolManager();
	const controller = new AbortController();
	controller.abort();

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: 'auto-accept',
		nonInteractiveAlwaysAllow: [],
		abortSignal: controller.signal,
	});

	t.is(outcome.kind, 'error');
});
