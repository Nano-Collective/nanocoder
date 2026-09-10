import {mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {SubagentExecutor} from './subagent-executor.js';
import {getAppConfig, reloadAppConfig} from '@/config/index';
import {
	getModelContextLimit,
	resetSessionContextLimit,
	setSessionContextLimit,
} from '@/models/index';
import {SubagentLoader, getSubagentLoader} from './subagent-loader.js';
import type {MemoryFinder} from '@/memory/project-context';
import {setProjectRoot} from '@/services/session-cwd';
import type {ToolManager} from '@/tools/tool-manager';
import type {HooksConfig} from '@/types/config';
import type {
	ApiCallRecord,
	LLMClient,
	LLMChatResponse,
	Message,
	ToolExecutionContext,
} from '@/types/core';
import {MAX_TOOL_RESULT_CHARS} from '@/constants';
import {
	resetAutoCompactSession,
	setAutoCompactEnabled,
	setAutoCompactStrategy,
	setAutoCompactThreshold,
} from '@/utils/auto-compact';
import {setGlobalToolApprovalHandler} from '@/utils/tool-approval-queue';

console.log('\nsubagent-executor.spec.ts');

// Helper to create a mock tool manager
function createMockToolManager(
	tools: Record<
		string,
		{
			handler: (
				args: unknown,
				options?: ToolExecutionContext,
			) => Promise<unknown>;
			readOnly: boolean;
			needsApproval?: boolean;
		}
	> = {},
): ToolManager {
	return {
		getAllTools: () => {
			const result: Record<string, unknown> = {};
			for (const name of Object.keys(tools)) {
				result[name] = {execute: tools[name].handler};
			}
			return result;
		},
		getToolHandler: (name: string) => tools[name]?.handler,
		getToolEntry: (name: string) => {
			const tool = tools[name];
			if (!tool) return undefined;
			return {
				approval: tool.needsApproval ?? false,
				readOnly: tool.readOnly,
			};
		},
		isReadOnly: (name: string) => tools[name]?.readOnly ?? false,
		getToolFormatter: () => undefined,
		getStreamingFormatter: () => undefined,
	} as unknown as ToolManager;
}

// Helper to create a mock LLM client
function createMockClient(
	responses: Array<{
		content: string;
		tool_calls?: Array<{
			id: string;
			function: {name: string; arguments: string};
		}>;
		usage?: LLMChatResponse['usage'];
	}>,
	onChat?: (messages: Message[]) => void,
): LLMClient {
	let callIndex = 0;
	let currentModel = 'test-model-sonnet-v1';

	return {
		chat: async (messages): Promise<LLMChatResponse> => {
			onChat?.(messages);
			const response = responses[callIndex] || {content: 'fallback'};
			callIndex++;
			return {
				choices: [{message: response}],
				toolsDisabled: false,
				usage: response.usage,
			} as unknown as LLMChatResponse;
		},
		getCurrentModel: () => currentModel,
		setModel: (model: string) => {
			currentModel = model;
		},
		getAvailableModels: async () => ['test-model-sonnet-v1'],
		getContextSize: () => 128000,
		getProviderConfig: () => ({
			name: 'TestProvider',
			type: 'openai',
			models: ['test-model-sonnet-v1'],
			config: {},
		}),
		clearContext: async () => {},
		getTimeout: () => undefined,
	} as unknown as LLMClient;
}

// Ensure loader is initialized before tests and set up auto-approve handler
test.before(async () => {
	const loader = getSubagentLoader();
	await loader.initialize();

	// Auto-approve all tool calls in tests (mirrors auto-accept mode)
	setGlobalToolApprovalHandler(async () => true);
});

test.serial('executes a simple task without tool calls', async t => {
	const toolManager = createMockToolManager();
	const client = createMockClient([{content: 'Here are the results'}]);
	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Find all test files',
	});

	t.true(result.success);
	t.is(result.output, 'Here are the results');
	t.is(result.subagentName, 'explore');
	t.true(result.executionTimeMs >= 0);
});

test.serial('reports provider usage for every subagent model call', async t => {
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'file contents', readOnly: true},
	});
	const client = createMockClient([
		{
			content: '',
			tool_calls: [
				{
					id: 'tc-usage',
					function: {
						name: 'read_file',
						arguments: '{"path":"file.txt"}',
					},
				},
			],
			usage: {
				inputTokens: 100,
				outputTokens: 20,
				totalTokens: 120,
				cacheReadTokens: 10,
				cacheWriteTokens: 5,
			},
		},
		{
			content: 'Done',
			usage: {inputTokens: 150, outputTokens: 30, totalTokens: 180},
		},
	]);
	const records: ApiCallRecord[] = [];
	let callbackFinished = false;
	const executor = new SubagentExecutor(
		toolManager,
		client,
		process.cwd(),
		'normal',
		async record => {
			await new Promise(resolve => setTimeout(resolve, 1));
			records.push(record);
			callbackFinished = true;
		},
	);

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Read file.txt',
	});

	t.true(result.success);
	t.true(callbackFinished);
	t.is(records.length, 2);
	t.deepEqual(
		records.map(({timestamp, ...record}) => record),
		[
			{
				provider: 'TestProvider',
				model: 'test-model-sonnet-v1',
				inputTokens: 100,
				outputTokens: 20,
				totalTokens: 120,
				cacheReadTokens: 10,
				cacheWriteTokens: 5,
			},
			{
				provider: 'TestProvider',
				model: 'test-model-sonnet-v1',
				inputTokens: 150,
				outputTokens: 30,
				totalTokens: 180,
			},
		],
	);
});

test.serial('preserves partial provider usage without estimating missing fields', async t => {
	const records: ApiCallRecord[] = [];
	const executor = new SubagentExecutor(
		createMockToolManager(),
		createMockClient([{content: 'Done', usage: {inputTokens: 42}}]),
		process.cwd(),
		'normal',
		record => records.push(record),
	);

	await executor.execute({
		subagent_type: 'explore',
		description: 'Test partial usage',
	});

	t.is(records.length, 1);
	t.is(records[0]?.inputTokens, 42);
	t.is(records[0]?.outputTokens, undefined);
	t.is(records[0]?.totalTokens, undefined);
});

test.serial('does not report a subagent call when the provider omits usage', async t => {
	const records: ApiCallRecord[] = [];
	const executor = new SubagentExecutor(
		createMockToolManager(),
		createMockClient([{content: 'Done'}]),
		process.cwd(),
		'normal',
		record => records.push(record),
	);

	await executor.execute({
		subagent_type: 'explore',
		description: 'Test missing usage',
	});

	t.deepEqual(records, []);
});

test.serial('ignores usage callback failures', async t => {
	const executor = new SubagentExecutor(
		createMockToolManager(),
		createMockClient([{content: 'Done', usage: {totalTokens: 10}}]),
		process.cwd(),
		'normal',
		async () => {
			throw new Error('stats unavailable');
		},
	);

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Test usage failure',
	});

	t.true(result.success);
	t.is(result.output, 'Done');
});

test.serial('returns error for non-existent subagent', async t => {
	const toolManager = createMockToolManager();
	const client = createMockClient([]);
	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute({
		subagent_type: 'non-existent',
		description: 'Test task',
	});

	t.false(result.success);
	t.regex(result.error || '', /not found/);
});

test.serial('respects max recursion depth', async t => {
	const toolManager = createMockToolManager();
	const client = createMockClient([]);
	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute(
		{subagent_type: 'explore', description: 'Test'},
		undefined,
		5, // depth exceeds MAX_SUBAGENT_DEPTH
	);

	t.false(result.success);
	t.regex(result.error || '', /recursion depth/);
});

test.serial('executes tool calls and returns final response', async t => {
	const readHandler = async (args: unknown) => {
		const parsed = args as {path: string};
		return `Contents of ${parsed.path}`;
	};

	const toolManager = createMockToolManager({
		read_file: {handler: readHandler, readOnly: true},
	});

	const client = createMockClient([
		// First response: tool call
		{
			content: '',
			tool_calls: [{
				id: 'tc1',
				function: {name: 'read_file', arguments: '{"path": "test.ts"}'},
			}],
		},
		// Second response: final answer
		{content: 'Found the file with 100 lines'},
	]);

	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Read test.ts',
	});

	t.true(result.success);
	t.is(result.output, 'Found the file with 100 lines');
});

test.serial('stringifies structured tool output without llmContent', async t => {
	const toolManager = createMockToolManager({
		read_file: {
			handler: async () => ({someField: 'value'}),
			readOnly: true,
		},
	});
	const toolResults: Message[] = [];
	const client = createMockClient(
		[
			{
				content: '',
				tool_calls: [{
					id: 'tc-structured',
					function: {name: 'read_file', arguments: '{}'},
				}],
			},
			{content: 'The tool returned structured data.'},
		],
		messages => {
			const toolMessage = messages.find(message => message.role === 'tool');
			if (toolMessage) toolResults.push(toolMessage);
		},
	);

	const executor = new SubagentExecutor(toolManager, client);
	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Read structured data',
	});

	t.true(result.success);
	t.is(result.output, 'The tool returned structured data.');
	t.is(toolResults[0]?.content, '{"someField":"value"}');
});

test.serial('forwards the parent execution context to subagent tools', async t => {
	let receivedContext: ToolExecutionContext | undefined;
	const toolManager = createMockToolManager({
		read_file: {
			handler: async (_args, options) => {
				receivedContext = options;
				return 'file contents';
			},
			readOnly: true,
		},
	});
	const client = createMockClient([
		{
			content: '',
			tool_calls: [
				{
					id: 'read',
					function: {name: 'read_file', arguments: '{"path":"a.ts"}'},
				},
			],
		},
		{content: 'done'},
	]);
	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute(
		{subagent_type: 'explore', description: 'Track the work'},
		undefined,
		0,
		'context-agent',
		{
			sessionId: '11111111-1111-4111-8111-111111111111',
			workingDirectory: '/workspace',
		},
	);

	t.true(result.success);
	t.is(receivedContext?.sessionId, '11111111-1111-4111-8111-111111111111');
	t.is(receivedContext?.workingDirectory, '/workspace');
});

test.serial('caps tool output before the next subagent model turn', async t => {
	const largeOutput = `HEAD\n${'middle\n'.repeat(MAX_TOOL_RESULT_CHARS)}TAIL`;
	const toolManager = createMockToolManager({
		read_file: {handler: async () => largeOutput, readOnly: true},
	});
	let toolMessages: Message[] = [];

	const client = createMockClient(
		[
			{
				content: '',
				tool_calls: [
					{
						id: 'tc-large',
						function: {
							name: 'read_file',
							arguments: '{"path":"large.txt"}',
						},
					},
				],
			},
			{content: 'The file was read.'},
		],
		messages => {
			const result = messages.find(message => message.role === 'tool');
			if (result) toolMessages = messages;
		},
	);

	const executor = new SubagentExecutor(toolManager, client);
	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Read large.txt',
	});

	t.true(result.success);
	const toolResult = toolMessages.find(message => message.role === 'tool');
	t.truthy(toolResult);
	t.is(toolResult?.content.length, MAX_TOOL_RESULT_CHARS);
	t.true(toolResult?.content.startsWith('HEAD\n') ?? false);
	t.true(toolResult?.content.endsWith('TAIL') ?? false);
});

test.serial('tools needing approval are surfaced via signalToolApproval', async t => {
	// git_status is on `explore`'s allow-list; the mock marks it as needing
	// approval so this exercises the approval path without depending on a
	// subagent being able to run a tool it was never granted.
	const toolManager = createMockToolManager({
		git_status: {
			handler: async () => 'clean',
			readOnly: false,
			needsApproval: true,
		},
		read_file: {handler: async () => 'content', readOnly: true},
	});

	// Track whether approval was requested
	let approvalRequested = false;
	const {setGlobalToolApprovalHandler} = await import('@/utils/tool-approval-queue.js');
	setGlobalToolApprovalHandler(async () => {
		approvalRequested = true;
		return true; // Approve
	});

	const client = createMockClient([
		{
			content: '',
			tool_calls: [{
				id: 'tc1',
				function: {name: 'git_status', arguments: '{}'},
			}],
		},
		{content: 'Done'},
	]);

	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Test tool approval',
	});

	t.true(result.success);
	t.true(approvalRequested, 'Approval should have been requested for git_status');

	// Restore auto-approve handler for other tests
	setGlobalToolApprovalHandler(async () => true);
});

test.serial('handles tool execution errors gracefully', async t => {
	const failingHandler = async () => {
		throw new Error('Tool crashed');
	};

	const toolManager = createMockToolManager({
		read_file: {handler: failingHandler, readOnly: true},
	});

	const client = createMockClient([
		{
			content: '',
			tool_calls: [{
				id: 'tc1',
				function: {name: 'read_file', arguments: '{"path": "x.ts"}'},
			}],
		},
		{content: 'Recovered from error'},
	]);

	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Test error handling',
	});

	t.true(result.success);
	t.is(result.output, 'Recovered from error');
});

test.serial('restores model after execution', async t => {
	const toolManager = createMockToolManager();
	const client = createMockClient([{content: 'Done'}]);
	const executor = new SubagentExecutor(toolManager, client);

	const originalModel = client.getCurrentModel();

	await executor.execute({
		subagent_type: 'explore', // uses 'inherit' model, no change expected
		description: 'Test',
	});

	t.is(client.getCurrentModel(), originalModel);
});

test.serial('handles unknown tool calls', async t => {
	const toolManager = createMockToolManager();
	const client = createMockClient([
		{
			content: '',
			tool_calls: [{
				id: 'tc1',
				function: {name: 'nonexistent_tool', arguments: '{}'},
			}],
		},
		{content: 'Handled missing tool'},
	]);

	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Test unknown tool',
	});

	t.true(result.success);
	t.is(result.output, 'Handled missing tool');
});

// --- Agent-loop retry limits (nanocoder.retries) — issue #897 ---

const repeatedCallResponse = (name = 'read_file') => ({
	content: '',
	tool_calls: [
		{id: 'tc-loop', function: {name, arguments: '{"path": "x"}'}},
	],
});

test.serial('repeated identical tool calls trip the retry cap', async t => {
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'same output', readOnly: true},
	});
	// Default maxRepeatedToolCalls = 3: the identical call executes on turns 1
	// and 2; the third consecutive emission stops the run before executing.
	const client = createMockClient([
		repeatedCallResponse(),
		repeatedCallResponse(),
		repeatedCallResponse(),
		{content: 'never reached'},
	]);
	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Loop forever',
	});

	t.false(result.success);
	t.regex(result.error || '', /repeated the same tool call 3 times/i);
	t.regex(result.error || '', /maxRepeatedToolCalls/);
});

test.serial('a tripped retry cap still returns the work done before the stop', async t => {
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'same output', readOnly: true},
	});
	const client = createMockClient([
		{...repeatedCallResponse(), content: 'found the config file'},
		{...repeatedCallResponse(), content: 'it sets the timeout to 30s'},
		repeatedCallResponse(),
	]);
	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Loop after doing useful work',
	});

	t.false(result.success);
	t.regex(result.output, /found the config file/);
	t.regex(result.output, /it sets the timeout to 30s/);
});

test.serial('identical tool calls one under the retry cap complete normally', async t => {
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'same output', readOnly: true},
	});
	const client = createMockClient([
		repeatedCallResponse(),
		repeatedCallResponse(),
		{content: 'done after two repeats'},
	]);
	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Repeat twice then finish',
	});

	t.true(result.success);
	t.is(result.output, 'done after two repeats');
});

test.serial('repeated unknown-tool calls trip the retry cap', async t => {
	// A subagent stuck calling a nonexistent tool must trip the cap too — the
	// signature covers every emitted call, not just executable ones.
	const toolManager = createMockToolManager();
	const client = createMockClient([
		repeatedCallResponse('ghost_tool'),
		repeatedCallResponse('ghost_tool'),
		repeatedCallResponse('ghost_tool'),
		{content: 'never reached'},
	]);
	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Loop on a missing tool',
	});

	t.false(result.success);
	t.regex(result.error || '', /repeated the same tool call 3 times/i);
});

test.serial('retry cap honors a custom configured maxRepeatedToolCalls', async t => {
	const retries = getAppConfig().retries;
	if (!retries) {
		t.fail('resolved config must carry retry limits');
		return;
	}
	const original = retries.maxRepeatedToolCalls;
	retries.maxRepeatedToolCalls = 2;
	try {
		const toolManager = createMockToolManager({
			read_file: {handler: async () => 'same output', readOnly: true},
		});
		const client = createMockClient([
			repeatedCallResponse(),
			repeatedCallResponse(),
			{content: 'never reached'},
		]);
		const executor = new SubagentExecutor(toolManager, client);

		const result = await executor.execute({
			subagent_type: 'explore',
			description: 'Loop with a tight cap',
		});

		t.false(result.success);
		t.regex(result.error || '', /repeated the same tool call 2 times/i);
	} finally {
		retries.maxRepeatedToolCalls = original;
	}
});

test.serial('respects abort signal', async t => {
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'content', readOnly: true},
	});

	const abortController = new AbortController();
	abortController.abort();

	const client = createMockClient([
		{
			content: '',
			tool_calls: [{
				id: 'tc1',
				function: {name: 'read_file', arguments: '{}'},
			}],
		},
		{content: 'Done'},
	]);

	// Override chat to throw on abort
	(client as any).chat = async (
		_msgs: unknown,
		_tools: unknown,
		_cb: unknown,
		signal?: AbortSignal,
	) => {
		if (signal?.aborted) {
			throw new Error('Aborted');
		}
		return {choices: [{message: {content: 'Done'}}]};
	};

	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute(
		{subagent_type: 'explore', description: 'Test abort'},
		abortController.signal,
	);

	t.false(result.success);
	t.regex(result.error || '', /Aborted/);
});

// ============================================================================
// Gap #1: filterTools excludes agent tool (prevents infinite recursion)
// ============================================================================

test.serial('filterTools excludes agent tool from subagent', async t => {
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'content', readOnly: true},
		agent: {handler: async () => 'agent result', readOnly: false},
	});

	let capturedTools: Record<string, unknown> = {};
	const client = createMockClient([{content: 'Done'}]);
	(client as any).chat = async (
		_msgs: unknown,
		tools: Record<string, unknown>,
	) => {
		capturedTools = tools;
		return {choices: [{message: {content: 'Done'}}]};
	};

	const executor = new SubagentExecutor(toolManager, client);
	await executor.execute({
		subagent_type: 'explore',
		description: 'Test agent exclusion',
	});

	t.true('read_file' in capturedTools, 'read_file should be in tools');
	t.false('agent' in capturedTools, 'agent tool should be excluded');
});

// ============================================================================
// Gap #3: prepareClient throws for unavailable model
// ============================================================================

test.serial('throws error for unavailable model', async t => {
	const toolManager = createMockToolManager();
	const client = createMockClient([{content: 'Done'}]);
	// getAvailableModels returns only test-model-sonnet-v1
	const executor = new SubagentExecutor(toolManager, client);

	// The explore agent uses 'inherit', so we need a custom agent with a bad model.
	// We can't easily test this without a custom subagent, so test via the error path:
	// Override getSubagent to return a config with a bad model
	const loader = getSubagentLoader();
	const originalGetSubagent = loader.getSubagent.bind(loader);
	loader.getSubagent = async (name: string) => {
		if (name === 'explore') {
			const agent = await originalGetSubagent(name);
			if (agent) {
				return {...agent, model: 'nonexistent-model-xyz'};
			}
		}
		return originalGetSubagent(name);
	};

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Test bad model',
	});

	// Restore
	loader.getSubagent = originalGetSubagent;

	t.false(result.success);
	t.regex(result.error || '', /not available/);
});

// ============================================================================
// Gap #6: filterTools with allowlist and disallowedTools
// ============================================================================

test.serial('filterTools respects allowlist from config', async t => {
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'content', readOnly: true},
		search_file_contents: {handler: async () => 'results', readOnly: true},
		find_files: {handler: async () => 'files', readOnly: true},
	});

	let capturedTools: Record<string, unknown> = {};
	const client = createMockClient([{content: 'Done'}]);
	(client as any).chat = async (
		_msgs: unknown,
		tools: Record<string, unknown>,
	) => {
		capturedTools = tools;
		return {choices: [{message: {content: 'Done'}}]};
	};

	// Override to return a config with only read_file allowed
	const loader = getSubagentLoader();
	const originalGetSubagent = loader.getSubagent.bind(loader);
	loader.getSubagent = async (name: string) => {
		if (name === 'explore') {
			const agent = await originalGetSubagent(name);
			if (agent) {
				return {...agent, tools: ['read_file']};
			}
		}
		return originalGetSubagent(name);
	};

	const executor = new SubagentExecutor(toolManager, client);
	await executor.execute({
		subagent_type: 'explore',
		description: 'Test allowlist',
	});

	loader.getSubagent = originalGetSubagent;

	t.true('read_file' in capturedTools, 'allowed tool should be present');
	t.false('search_file_contents' in capturedTools, 'non-allowed tool should be excluded');
	t.false('find_files' in capturedTools, 'non-allowed tool should be excluded');
});

test.serial('filterTools respects disallowedTools from config', async t => {
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'content', readOnly: true},
		search_file_contents: {handler: async () => 'results', readOnly: true},
	});

	let capturedTools: Record<string, unknown> = {};
	const client = createMockClient([{content: 'Done'}]);
	(client as any).chat = async (
		_msgs: unknown,
		tools: Record<string, unknown>,
	) => {
		capturedTools = tools;
		return {choices: [{message: {content: 'Done'}}]};
	};

	const loader = getSubagentLoader();
	const originalGetSubagent = loader.getSubagent.bind(loader);
	loader.getSubagent = async (name: string) => {
		if (name === 'explore') {
			const agent = await originalGetSubagent(name);
			if (agent) {
				return {...agent, tools: undefined, disallowedTools: ['search_file_contents']};
			}
		}
		return originalGetSubagent(name);
	};

	const executor = new SubagentExecutor(toolManager, client);
	await executor.execute({
		subagent_type: 'explore',
		description: 'Test disallowedTools',
	});

	loader.getSubagent = originalGetSubagent;

	t.true('read_file' in capturedTools, 'non-disallowed tool should be present');
	t.false('search_file_contents' in capturedTools, 'disallowed tool should be excluded');
});

// ============================================================================
// Parallel execution tests
// ============================================================================

test.serial('concurrent agents with agentId have isolated progress', async t => {
	const {
		getSubagentProgress,
		resetSubagentProgressById,
		clearAllSubagentProgress,
	} = await import('@/services/subagent-events.js');

	clearAllSubagentProgress();

	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'content', readOnly: true},
	});

	const client1 = createMockClient([{content: 'Result from agent 1'}]);
	const client2 = createMockClient([{content: 'Result from agent 2'}]);

	const executor1 = new SubagentExecutor(toolManager, client1);
	const executor2 = new SubagentExecutor(toolManager, client2);

	resetSubagentProgressById('agent-1');
	resetSubagentProgressById('agent-2');

	const [result1, result2] = await Promise.all([
		executor1.execute(
			{subagent_type: 'explore', description: 'Task 1'},
			undefined,
			0,
			'agent-1',
		),
		executor2.execute(
			{subagent_type: 'explore', description: 'Task 2'},
			undefined,
			0,
			'agent-2',
		),
	]);

	t.true(result1.success);
	t.true(result2.success);
	t.is(result1.output, 'Result from agent 1');
	t.is(result2.output, 'Result from agent 2');

	// Progress should be isolated
	const p1 = getSubagentProgress('agent-1');
	const p2 = getSubagentProgress('agent-2');
	t.is(p1.status, 'complete');
	t.is(p2.status, 'complete');

	clearAllSubagentProgress();
});

test.serial('error in one parallel agent does not break the other', async t => {
	const {clearAllSubagentProgress, resetSubagentProgressById} =
		await import('@/services/subagent-events.js');

	clearAllSubagentProgress();

	const toolManager = createMockToolManager();

	const successClient = createMockClient([{content: 'Success result'}]);
	const failClient = createMockClient([]);
	(failClient as any).chat = async () => {
		throw new Error('LLM provider unavailable');
	};

	const executor1 = new SubagentExecutor(toolManager, successClient);
	const executor2 = new SubagentExecutor(toolManager, failClient);

	resetSubagentProgressById('ok-agent');
	resetSubagentProgressById('fail-agent');

	const [result1, result2] = await Promise.all([
		executor1.execute(
			{subagent_type: 'explore', description: 'Will succeed'},
			undefined,
			0,
			'ok-agent',
		),
		executor2.execute(
			{subagent_type: 'explore', description: 'Will fail'},
			undefined,
			0,
			'fail-agent',
		),
	]);

	t.true(result1.success, 'First agent should succeed');
	t.is(result1.output, 'Success result');

	t.false(result2.success, 'Second agent should fail');
	t.regex(result2.error || '', /unavailable/);

	clearAllSubagentProgress();
});

test.serial('prepareClient creates independent client in concurrent mode', async t => {
	const toolManager = createMockToolManager();
	const client = createMockClient([{content: 'Done'}]);

	// Track model changes on the parent client
	const modelChanges: string[] = [];
	const originalSetModel = client.setModel.bind(client);
	client.setModel = (model: string) => {
		modelChanges.push(model);
		originalSetModel(model);
	};

	const executor = new SubagentExecutor(toolManager, client);

	// Override to request a specific model
	const loader = getSubagentLoader();
	const originalGetSubagent = loader.getSubagent.bind(loader);
	loader.getSubagent = async (name: string) => {
		if (name === 'explore') {
			const agent = await originalGetSubagent(name);
			if (agent) {
				return {...agent, model: 'different-model'};
			}
		}
		return originalGetSubagent(name);
	};

	// Execute with agentId (concurrent mode) — should NOT mutate parent client
	// Note: createLLMClient will fail since there's no real provider,
	// so the execute will fail, but the point is that setModel is NOT called
	await executor.execute(
		{subagent_type: 'explore', description: 'Test concurrent client'},
		undefined,
		0,
		'concurrent-agent',
	);

	loader.getSubagent = originalGetSubagent;

	// In concurrent mode, prepareClient should create a new client
	// rather than calling setModel on the parent
	t.is(modelChanges.length, 0, 'Parent client model should not be mutated in concurrent mode');
});

test.serial('concurrent agents with same type both complete', async t => {
	const {clearAllSubagentProgress, resetSubagentProgressById} =
		await import('@/services/subagent-events.js');

	clearAllSubagentProgress();

	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'file content', readOnly: true},
	});

	// Both agents use the same type but get different responses
	const client1 = createMockClient([
		{
			content: '',
			tool_calls: [{id: 'tc1', function: {name: 'read_file', arguments: '{"path": "a.ts"}'}}],
		},
		{content: 'Agent 1 found a.ts'},
	]);

	const client2 = createMockClient([
		{
			content: '',
			tool_calls: [{id: 'tc2', function: {name: 'read_file', arguments: '{"path": "b.ts"}'}}],
		},
		{content: 'Agent 2 found b.ts'},
	]);

	const executor1 = new SubagentExecutor(toolManager, client1);
	const executor2 = new SubagentExecutor(toolManager, client2);

	resetSubagentProgressById('same-type-1');
	resetSubagentProgressById('same-type-2');

	const [r1, r2] = await Promise.all([
		executor1.execute(
			{subagent_type: 'explore', description: 'Find a.ts'},
			undefined,
			0,
			'same-type-1',
		),
		executor2.execute(
			{subagent_type: 'explore', description: 'Find b.ts'},
			undefined,
			0,
			'same-type-2',
		),
	]);

	t.true(r1.success);
	t.true(r2.success);
	t.is(r1.output, 'Agent 1 found a.ts');
	t.is(r2.output, 'Agent 2 found b.ts');

	clearAllSubagentProgress();
});

test.serial(
	'appends each tool name to progress.toolHistory in invocation order',
	async t => {
		const {
			resetSubagentProgressById,
			getSubagentProgress,
			clearAllSubagentProgress,
		} = await import('@/services/subagent-events');

		clearAllSubagentProgress();
		resetSubagentProgressById('hist-agent');

		const toolManager = createMockToolManager({
			read_file: {handler: async () => 'content', readOnly: true},
			find_files: {handler: async () => 'files', readOnly: true},
		});

		const client = createMockClient([
			{
				content: '',
				tool_calls: [
					{
						id: 'tc1',
						function: {name: 'read_file', arguments: '{"path":"a.ts"}'},
					},
				],
			},
			{
				content: '',
				tool_calls: [
					{
						id: 'tc2',
						function: {name: 'find_files', arguments: '{"pattern":"*.ts"}'},
					},
					{
						id: 'tc3',
						function: {name: 'read_file', arguments: '{"path":"b.ts"}'},
					},
				],
			},
			{content: 'done'},
		]);

		const executor = new SubagentExecutor(toolManager, client);
		const result = await executor.execute(
			{subagent_type: 'explore', description: 'walk files'},
			undefined,
			0,
			'hist-agent',
		);

		t.true(result.success);
		t.deepEqual(getSubagentProgress('hist-agent').toolHistory, [
			'read_file',
			'find_files',
			'read_file',
		]);

		clearAllSubagentProgress();
	},
);

test.serial('subagent model can use provider-scoped context window override', async t => {
	const limit = await getModelContextLimit('special-subagent-model', {
		providerConfig: {
			name: 'Subagent Provider',
			type: 'openai',
			models: ['special-subagent-model'],
			contextWindows: {
				'special-subagent-model': 131072,
			},
			config: {},
		},
	});

	t.is(limit, 131072);
});

test('mode resolver overrides the static parentMode and is read live', async t => {
	const toolManager = createMockToolManager({
		execute_bash: {handler: async () => 'ok', readOnly: false, needsApproval: true},
	});
	const client = createMockClient([]);
	// Static parent mode is 'normal' (the buggy default), but a live resolver
	// is wired - it must win, and changing it must take effect immediately.
	const executor = new SubagentExecutor(
		toolManager,
		client,
		process.cwd(),
		'normal',
	);
	let mode: 'normal' | 'yolo' = 'yolo';
	executor.setModeResolver(() => mode);

	const needsApproval = (name: string) =>
		(executor as unknown as {
			needsApprovalForTool: (n: string, a: unknown) => Promise<boolean>;
		}).needsApprovalForTool(name, {});

	// yolo -> no approval, even though parentMode is 'normal'.
	t.false(await needsApproval('execute_bash'));

	// Flip the live source (simulating a mid-run switch) -> next check honors it.
	mode = 'normal';
	t.true(await needsApproval('execute_bash'));
});

test('without a resolver, approval falls back to the static parentMode', async t => {
	const toolManager = createMockToolManager({
		execute_bash: {handler: async () => 'ok', readOnly: false, needsApproval: true},
	});
	const client = createMockClient([]);
	const executor = new SubagentExecutor(
		toolManager,
		client,
		process.cwd(),
		'yolo',
	);

	const needsApproval = (executor as unknown as {
		needsApprovalForTool: (n: string, a: unknown) => Promise<boolean>;
	}).needsApprovalForTool('execute_bash', {});

	t.false(await needsApproval);
});

test.serial('subagents never receive the session-artifact tools', async t => {
	const called: string[] = [];
	const toolManager = createMockToolManager({
		read_file: {
			handler: async () => {
				called.push('read_file');
				return 'ok';
			},
			readOnly: true,
		},
		write_plan: {
			handler: async () => {
				called.push('write_plan');
				return 'plan saved';
			},
			readOnly: false,
		},
		write_tasks: {
			handler: async () => {
				called.push('write_tasks');
				return 'tasks saved';
			},
			readOnly: false,
		},
		write_walkthrough: {
			handler: async () => {
				called.push('write_walkthrough');
				return 'walkthrough saved';
			},
			readOnly: false,
		},
	});
	const client = createMockClient([
		{
			content: '',
			tool_calls: [
				{
					id: 'plan',
					function: {name: 'write_plan', arguments: '{"content":"clobber"}'},
				},
			],
		},
		{content: 'done'},
	]);
	const executor = new SubagentExecutor(toolManager, client);

	await executor.execute(
		{subagent_type: 'explore', description: 'Try to clobber the plan'},
		undefined,
		0,
		'artifact-agent',
		{sessionId: '11111111-1111-4111-8111-111111111111'},
	);

	t.deepEqual(called, [], 'no session-artifact tool may run inside a subagent');
});

test.serial('a subagent cannot execute a tool outside its allow-list', async t => {
	let wrote = false;
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'contents', readOnly: true},
		write_file: {
			handler: async () => {
				wrote = true;
				return 'written';
			},
			readOnly: false,
		},
	});
	let toolResult = '';
	const client = createMockClient(
		[
			{
				content: '',
				tool_calls: [
					{
						id: 'sneak',
						function: {
							name: 'write_file',
							arguments: '{"path":"x.ts","content":"hi"}',
						},
					},
				],
			},
			{content: 'done'},
		],
		messages => {
			const result = messages.find(message => message.role === 'tool');
			if (result) toolResult = result.content;
		},
	);
	const executor = new SubagentExecutor(toolManager, client);

	// `explore` declares a read-only tool list; write_file is not on it.
	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Try to write a file',
	});

	t.true(result.success);
	t.false(wrote, 'a read-only subagent must not be able to write files');
	t.regex(toolResult, /not available to this subagent/);
});

test.serial('injects relevant project memories into the subagent system prompt', async t => {
	const toolManager = createMockToolManager();
	const client = createMockClient([{content: 'Here are the results'}]);
	let systemPrompt = '';
	const originalChat = client.chat.bind(client);
	client.chat = async (messages: Message[], tools, callbacks, signal, modeOverrides) => {
		systemPrompt = String(messages[0]?.content ?? '');
		return originalChat(messages, tools, callbacks, signal, modeOverrides);
	};

	const memoryFinder: MemoryFinder = {
		findRelevantMemories: async () => [
			{
				id: 'mem-1',
				content: 'Auth flow uses Clerk and avoids middleware.',
				category: 'architecture',
				timestamp: '2026-01-01T00:00:00.000Z',
			},
		],
	};

	const executor = new SubagentExecutor(toolManager, client, process.cwd(), 'normal', {
		memoryFinder,
		projectContextOptions: {semanticMemoryEnabled: true},
	});

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Refactor Clerk auth',
	});

	t.true(result.success);
	t.true(systemPrompt.includes('## Project Context'));
	t.true(systemPrompt.includes('Auth flow uses Clerk and avoids middleware.'));
});

test.serial('skips subagent memory recall when semantic memory is disabled', async t => {
	const toolManager = createMockToolManager();
	const client = createMockClient([{content: 'Here are the results'}]);
	let systemPrompt = '';
	const originalChat = client.chat.bind(client);
	client.chat = async (messages: Message[], tools, callbacks, signal, modeOverrides) => {
		systemPrompt = String(messages[0]?.content ?? '');
		return originalChat(messages, tools, callbacks, signal, modeOverrides);
	};

	let finderCalls = 0;
	const memoryFinder: MemoryFinder = {
		findRelevantMemories: async () => {
			finderCalls++;
			return [
				{
					id: 'mem-1',
					content: 'Auth flow uses Clerk and avoids middleware.',
					category: 'architecture',
					timestamp: '2026-01-01T00:00:00.000Z',
				},
			];
		},
	};

	const executor = new SubagentExecutor(toolManager, client, process.cwd(), 'normal', {
		memoryFinder,
		projectContextOptions: {semanticMemoryEnabled: false},
	});

	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Refactor Clerk auth',
	});

	t.true(result.success);
	t.is(finderCalls, 0);
	t.false(systemPrompt.includes('## Project Context'));
});

test.serial(
	'caps subagent history before client.chat without starting on a tool row',
	async t => {
		if (getAppConfig().sessions) {
			getAppConfig().sessions.maxMessages = 3;
		}

		const payloads: Message[][] = [];
		const toolManager = createMockToolManager({
			read_file: {handler: async () => 'ok', readOnly: true},
		});
		const client = createMockClient(
			[
				{
					content: '',
					tool_calls: [
						{
							id: 't1',
							function: {name: 'read_file', arguments: '{"path":"a.ts"}'},
						},
					],
				},
				{
					content: '',
					tool_calls: [
						{
							id: 't2',
							function: {name: 'read_file', arguments: '{"path":"b.ts"}'},
						},
					],
				},
				{
					content: '',
					tool_calls: [
						{
							id: 't3',
							function: {name: 'read_file', arguments: '{"path":"c.ts"}'},
						},
					],
				},
				{content: 'done'},
			],
			messages => {
				payloads.push(messages);
			},
		);
		const executor = new SubagentExecutor(toolManager, client);

		try {
			const result = await executor.execute({
				subagent_type: 'explore',
				description: 'Read a few files',
			});

			t.true(result.success);
			t.is(payloads.length, 4);
			const last = payloads[3];
			t.is(last[0]?.role, 'system');
			t.not(last[1]?.role, 'tool');
			t.true(
				last.length <= 5,
				'cap walks back to keep a full assistant/tool turn',
			);
		} finally {
			reloadAppConfig();
		}
	},
);

test.serial('compacts subagent history after a tool turn', async t => {
	resetSessionContextLimit();
	setSessionContextLimit(80);
	setAutoCompactEnabled(true);
	setAutoCompactStrategy('mechanical');
	setAutoCompactThreshold(50);

	const blob = 'old context sentence. '.repeat(80);
	const payloads: Message[][] = [];
	let reads = 0;
	const toolManager = createMockToolManager({
		read_file: {
			handler: async () => {
				reads += 1;
				return reads === 1 ? blob : `ok-${reads}`;
			},
			readOnly: true,
		},
	});
	const client = createMockClient(
		[
			{
				content: '',
				tool_calls: [
					{
						id: 't1',
						function: {name: 'read_file', arguments: '{"path":"a.ts"}'},
					},
				],
			},
			{
				content: '',
				tool_calls: [
					{
						id: 't2',
						function: {name: 'read_file', arguments: '{"path":"b.ts"}'},
					},
				],
			},
			{
				content: '',
				tool_calls: [
					{
						id: 't3',
						function: {name: 'read_file', arguments: '{"path":"c.ts"}'},
					},
				],
			},
			{content: 'done'},
		],
		messages => {
			payloads.push(messages);
		},
	);
	const executor = new SubagentExecutor(toolManager, client);

	try {
		const result = await executor.execute({
			subagent_type: 'explore',
			description: 'Read a file',
		});
		t.true(result.success);
		t.true(payloads.length >= 4);
		const last = payloads[3];
		t.is(last[0]?.role, 'system');
		t.false(
			last.some(
				message =>
					typeof message.content === 'string' && message.content === blob,
			),
			'an earlier tool blob must be compressed out of the later model turn',
		);
	} finally {
		resetAutoCompactSession();
		resetSessionContextLimit();
	}
});

// ============================================================================
// Lifecycle hooks in delegated work.
//
// Subagents run their own loop instead of going through processToolUse, so a
// policy hook would silently not apply to them unless the gate is repeated
// here — and, as in the main loop, it has to sit in front of the approval
// prompt rather than behind it.
// ============================================================================

const SUBAGENT_HOOK_DIR = join(
	tmpdir(),
	`nanocoder-subagent-hooks-${Date.now()}`,
);

function enterSubagentHookFixture(hooks: HooksConfig): () => void {
	const previousCwd = process.cwd();
	const previousConfigDir = process.env.NANOCODER_CONFIG_DIR;
	mkdirSync(SUBAGENT_HOOK_DIR, {recursive: true});
	process.env.NANOCODER_CONFIG_DIR = join(
		SUBAGENT_HOOK_DIR,
		'no-global-config',
	);
	process.chdir(SUBAGENT_HOOK_DIR);
	setProjectRoot(SUBAGENT_HOOK_DIR);
	writeFileSync(
		join(SUBAGENT_HOOK_DIR, 'agents.config.json'),
		JSON.stringify({nanocoder: {hooks}}),
		'utf-8',
	);
	reloadAppConfig();
	return () => {
		process.chdir(previousCwd);
		if (previousConfigDir === undefined) {
			delete process.env.NANOCODER_CONFIG_DIR;
		} else {
			process.env.NANOCODER_CONFIG_DIR = previousConfigDir;
		}
		setProjectRoot(previousCwd);
		reloadAppConfig();
	};
}

// Portable hook body: `sh -c` on POSIX, `cmd /c` on Windows.
const subagentHookNode = (script: string) => `node -e "${script}"`;

test.serial('a pre-tool-use veto stops a subagent tool call', async t => {
	let handlerRan = false;
	const toolManager = createMockToolManager({
		read_file: {
			handler: async () => {
				handlerRan = true;
				return 'secrets';
			},
			readOnly: true,
		},
	});

	const toolResults: Message[] = [];
	const client = createMockClient(
		[
			{
				content: '',
				tool_calls: [
					{
						id: 'tc-veto',
						function: {name: 'read_file', arguments: '{"path": ".env"}'},
					},
				],
			},
			{content: 'Understood, leaving .env alone.'},
		],
		messages => {
			const toolMessage = messages.find(message => message.role === 'tool');
			if (toolMessage) toolResults.push(toolMessage);
		},
	);

	const leave = enterSubagentHookFixture({
		'pre-tool-use': [
			{
				name: 'no-env',
				command: subagentHookNode(
					"console.log('.env is off limits');process.exit(1)",
				),
			},
		],
	});
	let result: Awaited<ReturnType<SubagentExecutor['execute']>>;
	try {
		const executor = new SubagentExecutor(toolManager, client);
		result = await executor.execute({
			subagent_type: 'explore',
			description: 'Read .env',
		});
	} finally {
		leave();
	}

	t.true(result.success);
	t.false(handlerRan, 'a policy hook must hold for delegated work too');
	t.is(
		toolResults[0]?.content,
		'Error: Blocked by hook "no-env": .env is off limits',
	);
});

test.serial(
	'a subagent veto happens before the approval prompt',
	async t => {
		let approvalPrompts = 0;
		setGlobalToolApprovalHandler(async () => {
			approvalPrompts++;
			return true;
		});

		const toolManager = createMockToolManager({
			write_file: {
				handler: async () => 'wrote it',
				readOnly: false,
				needsApproval: true,
			},
		});
		const client = createMockClient([
			{
				content: '',
				tool_calls: [
					{
						id: 'tc-approve',
						function: {name: 'write_file', arguments: '{"path": ".env"}'},
					},
				],
			},
			{content: 'Understood.'},
		]);

		const leave = enterSubagentHookFixture({
			'pre-tool-use': [
				{name: 'no-env', command: subagentHookNode('process.exit(1)')},
			],
		});
		try {
			const executor = new SubagentExecutor(toolManager, client);
			await executor.execute({
				subagent_type: 'general-purpose',
				description: 'Write .env',
			});
		} finally {
			leave();
			setGlobalToolApprovalHandler(async () => true);
		}

		t.is(
			approvalPrompts,
			0,
			'a vetoed tool must not ask the user to approve it first',
		);
	},
);

test.serial('post-tool-use output reaches a subagent tool result', async t => {
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'file contents', readOnly: true},
	});
	const toolResults: Message[] = [];
	const client = createMockClient(
		[
			{
				content: '',
				tool_calls: [
					{
						id: 'tc-post',
						function: {name: 'read_file', arguments: '{"path": "a.ts"}'},
					},
				],
			},
			{content: 'Read it.'},
		],
		messages => {
			const toolMessage = messages.find(message => message.role === 'tool');
			if (toolMessage) toolResults.push(toolMessage);
		},
	);

	const leave = enterSubagentHookFixture({
		'post-tool-use': [
			{command: subagentHookNode("console.log('observed')")},
		],
	});
	try {
		const executor = new SubagentExecutor(toolManager, client);
		await executor.execute({
			subagent_type: 'explore',
			description: 'Read a.ts',
		});
	} finally {
		leave();
	}

	t.is(
		toolResults[0]?.content,
		'file contents\n\n<hook-output event="post-tool-use">\nobserved\n</hook-output>',
	);
});

test.serial('post-tool-use fires when a subagent tool throws', async t => {
	const toolManager = createMockToolManager({
		read_file: {
			handler: async () => {
				throw new Error('no such file');
			},
			readOnly: true,
		},
	});
	const toolResults: Message[] = [];
	const client = createMockClient(
		[
			{
				content: '',
				tool_calls: [
					{
						id: 'tc-throw',
						function: {name: 'read_file', arguments: '{"path": "gone.ts"}'},
					},
				],
			},
			{content: 'It is missing.'},
		],
		messages => {
			const toolMessage = messages.find(message => message.role === 'tool');
			if (toolMessage) toolResults.push(toolMessage);
		},
	);

	const leave = enterSubagentHookFixture({
		'post-tool-use': [{command: subagentHookNode("console.log('audited')")}],
	});
	try {
		const executor = new SubagentExecutor(toolManager, client);
		await executor.execute({
			subagent_type: 'explore',
			description: 'Read gone.ts',
		});
	} finally {
		leave();
	}

	const content = String(toolResults[0]?.content ?? '');
	t.true(content.includes('no such file'), 'the error still reaches the model');
	t.true(
		content.includes('audited'),
		'an audit-log hook must see the failed delegated call too',
	);
});
