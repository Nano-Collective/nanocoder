import {execSync} from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
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
import {loadPlugins, resetPluginsForTests} from '@/plugins/host';
import {filterToolNamesForMode, type ToolManager} from '@/tools/tool-manager';
import type {HooksConfig} from '@/types/config';
import type {
	ApiCallRecord,
	DevelopmentMode,
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
import {
	cancelSubagentRun,
	onSubagentRunEvent,
	type SubagentRunEvent,
} from '@/services/subagent-events';
import {
	registerSubagentToolBridge,
	setGlobalToolApprovalHandler,
	type SubagentToolBridge,
} from '@/utils/tool-approval-queue';
import {
	clearReadTracker,
	forgetReadContent,
	matchReadContent,
	rememberReadContent,
	runWithReadContentScope,
} from '@/utils/read-tracker';

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
			ownerSkill?: string;
		}
	> = {},
): ToolManager {
	return {
		filterToolNamesForMode: (names: string[], mode: DevelopmentMode) =>
			filterToolNamesForMode(names, mode, {
				getCustomToolPolicy: () => undefined,
				getMcpReadOnly: () => undefined,
			}),
		getOwnerSkill: (name: string) => tools[name]?.ownerSkill,
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

test.serial('toolOverride replaces the effective tool list beyond what frontmatter declares', async t => {
	// 'explore's frontmatter tools list does not include write_file, so
	// without an override this call would be filtered out before reaching
	// the model. toolOverride.tools should replace the effective list.
	const writeHandler = async (args: unknown) => {
		const parsed = args as {path: string};
		return `Wrote ${parsed.path}`;
	};

	const toolManager = createMockToolManager({
		write_file: {handler: writeHandler, readOnly: false},
	});

	const client = createMockClient([
		{
			content: '',
			tool_calls: [{
				id: 'tc1',
				function: {name: 'write_file', arguments: '{"path": "out.txt"}'},
			}],
		},
		{content: 'Wrote the file'},
	]);

	const executor = new SubagentExecutor(toolManager, client);

	const result = await executor.execute(
		{subagent_type: 'explore', description: 'Write a file'},
		undefined,
		0,
		undefined,
		undefined,
		{tools: ['write_file']},
	);

	t.true(result.success);
	t.is(result.output, 'Wrote the file');
});

test.serial('keeps screenshot images on a subagent tool message', async t => {
	const toolManager = createMockToolManager({
		read_file: {
			handler: async () => ({
				llmContent: 'Screenshot of http://localhost:3000/',
				images: [{data: 'abc', mediaType: 'image/jpeg'}],
			}),
			readOnly: true,
		},
	});
	const toolResults: Message[] = [];
	const client = createMockClient(
		[
			{
				content: '',
				tool_calls: [{
					id: 'tc-shot',
					function: {name: 'read_file', arguments: '{}'},
				}],
			},
			{content: 'The button is misaligned.'},
		],
		messages => {
			const toolMessage = messages.find(message => message.role === 'tool');
			if (toolMessage) toolResults.push(toolMessage);
		},
	);

	const executor = new SubagentExecutor(toolManager, client);
	const result = await executor.execute({
		subagent_type: 'explore',
		description: 'Look at the page',
	});

	t.true(result.success);
	t.is(toolResults[0]?.content, 'Screenshot of http://localhost:3000/');
	t.deepEqual(toolResults[0]?.images, [{data: 'abc', mediaType: 'image/jpeg'}]);
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
	// At most the cap. The cut snaps back to whitespace so it never splits a
	// token (a secret fragment would slip past the scrubber), which can leave
	// the result a little under it.
	const length = toolResult?.content.length ?? 0;
	t.true(length <= MAX_TOOL_RESULT_CHARS);
	t.true(length > MAX_TOOL_RESULT_CHARS - 512);
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

// ============================================================================
// Phase 4: toolOverride.alwaysAllow bypasses approval for otherwise
// mode-blind, unconditionally-approval-required tools (e.g. git_commit's
// `approval: true`, which would otherwise be silently auto-denied in
// headless mode since no approval-queue handler is ever registered there).
// ============================================================================

test.serial('needsApprovalForTool: alwaysAllow bypasses an unconditional approval:true policy', async t => {
	const toolManager = createMockToolManager({
		git_commit: {handler: async () => 'committed', readOnly: false, needsApproval: true},
	});
	const client = createMockClient([]);
	const executor = new SubagentExecutor(toolManager, client, process.cwd(), 'headless');

	const needsApproval = (alwaysAllow?: string[]) =>
		(executor as unknown as {
			needsApprovalForTool: (
				n: string,
				a: unknown,
				alwaysAllow?: string[],
			) => Promise<boolean>;
		}).needsApprovalForTool('git_commit', {}, alwaysAllow);

	t.true(
		await needsApproval(undefined),
		'without alwaysAllow, git_commit still requires approval even in headless mode',
	);
	t.false(
		await needsApproval(['git_commit']),
		'alwaysAllow including git_commit bypasses its approval:true policy',
	);
	t.true(
		await needsApproval(['some_other_tool']),
		'alwaysAllow not including git_commit does not bypass it',
	);
});

test.serial('execute(): toolOverride.alwaysAllow lets an approval-required tool run without signalToolApproval', async t => {
	const commitHandler = async () => 'committed';
	const toolManager = createMockToolManager({
		git_commit: {handler: commitHandler, readOnly: false, needsApproval: true},
	});

	let approvalRequested = false;
	setGlobalToolApprovalHandler(async () => {
		approvalRequested = true;
		return true;
	});

	const client = createMockClient([
		{
			content: '',
			tool_calls: [
				{id: 'tc1', function: {name: 'git_commit', arguments: '{"message":"fix"}'}},
			],
		},
		{content: 'Committed the fix'},
	]);

	const executor = new SubagentExecutor(toolManager, client, process.cwd(), 'headless');

	const result = await executor.execute(
		{subagent_type: 'explore', description: 'Commit a fix'},
		undefined,
		0,
		undefined,
		{tools: ['git_commit'], alwaysAllow: ['git_commit']},
	);

	t.true(result.success);
	t.is(result.output, 'Committed the fix');
	t.false(
		approvalRequested,
		'signalToolApproval should never be reached when alwaysAllow covers the tool',
	);

	// Restore auto-approve handler for other tests
	setGlobalToolApprovalHandler(async () => true);
});

test.serial('execute(): a trustLevel denies git_pr comment/review/create even when approval would be granted', async t => {
	const gitPrCalls: unknown[] = [];
	const toolManager = createMockToolManager({
		git_pr: {
			handler: async args => {
				gitPrCalls.push(args);
				return 'ok';
			},
			readOnly: false,
			needsApproval: true,
		},
	});

	// The global handler approves everything, so only the trust-level check
	// stands between the model and a posted review.
	setGlobalToolApprovalHandler(async () => true);

	const call = (id: string, args: object) => ({
		id,
		function: {name: 'git_pr', arguments: JSON.stringify(args)},
	});
	const toolResults = new Map<string, string>();
	const client = createMockClient(
		[
			{
				content: '',
				tool_calls: [
					call('tc1', {review: {pr: 7, verdict: 'approve'}}),
					call('tc2', {comment: {pr: 7, body: 'x'}}),
					call('tc3', {create: {title: 'x'}}),
					call('tc4', {diff: 7}),
				],
			},
			{content: 'done'},
		],
		messages => {
			for (const m of messages) {
				if (m.role === 'tool' && m.tool_call_id) {
					toolResults.set(m.tool_call_id, String(m.content));
				}
			}
		},
	);
	const executor = new SubagentExecutor(toolManager, client, process.cwd(), 'headless');

	const result = await executor.execute(
		{subagent_type: 'explore', description: 'Review a PR'},
		undefined,
		0,
		undefined,
		undefined,
		{tools: ['git_pr'], alwaysAllow: [], trustLevel: 'comment-only'},
	);

	t.true(result.success);
	t.deepEqual(gitPrCalls, [{diff: 7}], 'only the read-only action may run');
	// Pin which call was denied: review, comment and create by id, not just
	// "three of four", so a swapped decision can't pass.
	for (const id of ['tc1', 'tc2', 'tc3']) {
		t.regex(toolResults.get(id) ?? '', /not permitted at trust level/, id);
	}
	t.is(toolResults.get('tc4'), 'ok', 'the read-only diff call ran');
});

test.serial('execute(): an explicit alwaysAllow replaces the project config alwaysAllow', async t => {
	const leave = enterSubagentHookFixture({}, {alwaysAllow: ['git_pr']});
	try {
		const toolManager = createMockToolManager({
			git_pr: {handler: async () => 'ok', readOnly: false, needsApproval: true},
		});
		const executor = new SubagentExecutor(
			toolManager,
			createMockClient([]),
			process.cwd(),
			'headless',
		);
		const needsApproval = (alwaysAllow?: string[]) =>
			(executor as unknown as {
				needsApprovalForTool: (
					n: string,
					a: unknown,
					alwaysAllow?: string[],
				) => Promise<boolean>;
			}).needsApprovalForTool('git_pr', {}, alwaysAllow);

		t.false(
			await needsApproval(undefined),
			'with no override the project config still applies',
		);
		t.true(
			await needsApproval([]),
			'an explicit override must not inherit the project config',
		);
		t.false(await needsApproval(['git_pr']));
	} finally {
		leave();
	}
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

function enterSubagentHookFixture(
	hooks: HooksConfig,
	extraConfig: Record<string, unknown> = {},
): () => void {
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
		JSON.stringify({nanocoder: {hooks, ...extraConfig}}),
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

test.serial('a plugin permission denial prevents delegated tool execution and approval', async t => {
	const leave = enterSubagentHookFixture({});
	resetPluginsForTests();
	let approvalPrompts = 0;
	let executions = 0;
	const results: string[] = [];
	setGlobalToolApprovalHandler(async () => {
		approvalPrompts++;
		return true;
	});
	try {
		const dir = join(SUBAGENT_HOOK_DIR, '.nanocoder', 'plugins');
		mkdirSync(dir, {recursive: true});
		writeFileSync(join(dir, 'deny.mjs'), `export default {
			apiVersion: 1, name: 'deny',
			hooks: {'permission.asked': () => ({decision: 'deny', reason: 'delegated policy'})},
		};`);
		await loadPlugins(true);
		const toolManager = createMockToolManager({
			read_file: {
				handler: async () => { executions++; return 'contents'; },
				readOnly: true,
				needsApproval: true,
			},
		});
		const client = createMockClient([
			{content: '', tool_calls: [{
				id: 'plugin-deny', function: {name: 'read_file', arguments: '{"path":"a.ts"}'},
			}]},
			{content: 'Understood.'},
		], messages => {
			for (const message of messages) {
				if (message.role === 'tool') results.push(message.content);
			}
		});
		await new SubagentExecutor(toolManager, client).execute({
			subagent_type: 'explore', description: 'Read a.ts',
		});
		t.is(approvalPrompts, 0);
		t.is(executions, 0);
		t.true(results.includes('Error: delegated policy'));
	} finally {
		resetPluginsForTests();
		leave();
		setGlobalToolApprovalHandler(async () => true);
	}
});

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

test.serial(
	'subagent read stubs stay isolated from the parent and are dropped on finish',
	async t => {
		clearReadTracker();
		const filePath = '/tmp/parent-read.txt';
		const stats = {mtimeMs: 11, size: 8};
		rememberReadContent(filePath, stats, 3);

		let seenInSubagent: ReturnType<typeof matchReadContent>;
		seenInSubagent = {lineCount: -1, size: -1};
		const toolManager = createMockToolManager({
			read_file: {
				handler: async () => {
					seenInSubagent = matchReadContent(filePath, stats);
					rememberReadContent(filePath, stats, 9);
					forgetReadContent(filePath);
					return 'subagent body';
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
						function: {
							name: 'read_file',
							arguments: '{"path":"/tmp/parent-read.txt"}',
						},
					},
				],
			},
			{content: 'done'},
		]);
		const executor = new SubagentExecutor(toolManager, client);
		const result = await executor.execute(
			{subagent_type: 'explore', description: 'Read a file'},
			undefined,
			0,
			'stub-scope-agent',
		);

		t.true(result.success);
		t.is(seenInSubagent, undefined);
		t.deepEqual(matchReadContent(filePath, stats), {lineCount: 3, size: 8});
		runWithReadContentScope('stub-scope-agent', () => {
			t.is(matchReadContent(filePath, stats), undefined);
		});
	},
);

// ============================================================================
// nanocoder.autoCommit in delegated work.
//
// Subagents do not go through processToolUse, so auto-commit has to be wired
// into their loop separately — and, as there, after the post-tool-use hooks.
// ============================================================================

test.serial(
	'a subagent edit is auto-committed, including a formatter hook rewrite',
	async t => {
		const repo = realpathSync(
			mkdtempSync(join(tmpdir(), 'nanocoder-subagent-autocommit-')),
		);
		const git = (command: string) =>
			execSync(`git ${command}`, {cwd: repo, encoding: 'utf8'}).trimEnd();
		git('init -q -b main');
		git('config user.email test@example.com');
		git('config user.name Test');
		git('config commit.gpgsign false');
		git('config core.autocrlf false');
		git('config core.hooksPath .no-hooks');
		git('commit -q --allow-empty -m baseline');

		// A project subagent allowed to write, kept outside the repo so its
		// definition does not show up as an untracked change.
		const agentsRoot = realpathSync(
			mkdtempSync(join(tmpdir(), 'nanocoder-subagent-writer-')),
		);
		mkdirSync(join(agentsRoot, '.nanocoder', 'agents'), {recursive: true});
		writeFileSync(
			join(agentsRoot, '.nanocoder', 'agents', 'writer.md'),
			'---\nname: writer\ndescription: writer\ntools:\n  - write_file\n---\nwrite\n',
			'utf-8',
		);

		const file = join(repo, 'edited.ts');
		const toolManager = createMockToolManager({
			write_file: {
				handler: async args => {
					writeFileSync(String((args as {path: string}).path), 'agent\n');
					return 'File written.';
				},
				readOnly: false,
			},
		});
		const toolResults: Message[] = [];
		const client = createMockClient(
			[
				{
					content: '',
					tool_calls: [
						{
							id: 'tc-commit',
							function: {
								name: 'write_file',
								arguments: JSON.stringify({path: file}),
							},
						},
					],
				},
				{content: 'Done.'},
			],
			messages => {
				const toolMessage = messages.find(message => message.role === 'tool');
				if (toolMessage) toolResults.push(toolMessage);
			},
		);

		const leave = enterSubagentHookFixture({
			'post-tool-use': [
				{
					command: subagentHookNode(
						"require('fs').appendFileSync(process.env.NANOCODER_FILE, 'formatted\\n')",
					),
				},
			],
		});
		getAppConfig().autoCommit = true;
		getAppConfig().formatters = [{match: ['**/*.ts'], command: subagentHookNode(
			"require('fs').appendFileSync(process.env.FILE, 'formatter\\n')",
		)}];
		setProjectRoot(repo);
		let result: Awaited<ReturnType<SubagentExecutor['execute']>>;
		let committed: string;
		let status: string;
		try {
			result = await new SubagentExecutor(
				toolManager,
				client,
				agentsRoot,
			).execute({subagent_type: 'writer', description: 'Write edited.ts'});
			committed = git('show HEAD:edited.ts');
			status = git('status --porcelain');
		} finally {
			// reloadAppConfig() in leave() also turns autoCommit back off.
			leave();
			rmSync(repo, {recursive: true, force: true});
			rmSync(agentsRoot, {recursive: true, force: true});
		}

		t.true(result.success, result.error);
		t.regex(String(toolResults[0]?.content), /\[auto-commit\] [a-f0-9]{7,} /);
		t.is(committed, 'agent\nformatter\nformatted');
		t.is(status, '', 'nothing the edit or the hook wrote is left behind');
	},
);

test.serial('execute(): a trustLevel resolves the subagent from built-ins, ignoring a project override', async t => {
	const tempDir = mkdtempSync(join(tmpdir(), 'nanocoder-trust-builtin-'));
	const agentsDir = join(tempDir, '.nanocoder', 'agents');
	mkdirSync(agentsDir, {recursive: true});
	writeFileSync(
		join(agentsDir, 'explore.md'),
		`---
name: explore
description: Hijacked
---
HIJACKED-SYSTEM-PROMPT`,
		'utf-8',
	);

	const systemPrompts: string[] = [];
	const capture = (messages: Message[]) => {
		for (const m of messages) {
			if (m.role === 'system') systemPrompts.push(String(m.content));
		}
	};

	try {
		const run = async (trustLevel?: 'comment-only') => {
			systemPrompts.length = 0;
			const executor = new SubagentExecutor(
				createMockToolManager({}),
				createMockClient([{content: 'done'}], capture),
				tempDir,
				'headless',
			);
			await executor.execute(
				{subagent_type: 'explore', description: 'Look around'},
				undefined,
				0,
				undefined,
				undefined,
				trustLevel ? {tools: [], alwaysAllow: [], trustLevel} : undefined,
			);
			return systemPrompts.join('\n');
		};

		t.true(
			(await run()).includes('HIJACKED-SYSTEM-PROMPT'),
			'precondition: without a trust level the project agent wins',
		);
		t.false(
			(await run('comment-only')).includes('HIJACKED-SYSTEM-PROMPT'),
			'a trust-gated run must use the built-in definition',
		);
	} finally {
		getSubagentLoader(process.cwd());
		rmSync(tempDir, {recursive: true, force: true});
	}
});

// ============================================================================
// Per-session tool bridge (#1105): a client that takes subagent tool calls
// sees every call, approves by its own session's mode, and gets the outcome.
// ============================================================================

const createRecordingBridge = (
	options: {
		mode?: DevelopmentMode;
		decision?: 'approved' | 'denied' | 'cancelled';
	} = {},
) => {
	const events: string[] = [];
	const bridge: SubagentToolBridge = {
		getMode: () => options.mode ?? 'normal',
		begin: async toolCall => {
			events.push(`begin ${toolCall.id}`);
		},
		approve: async toolCall => {
			events.push(`approve ${toolCall.id}`);
			return options.decision ?? 'approved';
		},
		end: async (toolCall, {content, failed}) => {
			events.push(`end ${toolCall.id} ${failed ? 'failed' : 'ok'} ${content}`);
		},
	};
	return {bridge, events};
};

const runExploreWithBridge = async (
	toolManager: ToolManager,
	toolCalls: Array<{id: string; name: string; args?: string}>,
	bridge: SubagentToolBridge,
	executor = new SubagentExecutor(
		toolManager,
		createMockClient([
			{
				content: '',
				tool_calls: toolCalls.map(call => ({
					id: call.id,
					function: {name: call.name, arguments: call.args ?? '{}'},
				})),
			},
			{content: 'Done'},
		]),
	),
	agentId = 'agent-1',
) => {
	const unregister = registerSubagentToolBridge('session-1', bridge);
	try {
		return await executor.execute(
			{subagent_type: 'explore', description: 'Test the bridge'},
			undefined,
			0,
			agentId,
			{sessionId: 'session-1'},
		);
	} finally {
		unregister();
	}
};

test.serial('a bridge sees every tool call, approved or not, settled with its real result', async t => {
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'content', readOnly: true},
		git_status: {
			handler: async () => 'clean',
			readOnly: false,
			needsApproval: true,
		},
	});
	const {bridge, events} = createRecordingBridge();

	const result = await runExploreWithBridge(
		toolManager,
		[
			{id: 'tc1', name: 'read_file', args: '{"path":"a.txt"}'},
			{id: 'tc2', name: 'git_status'},
		],
		bridge,
	);

	t.true(result.success);
	// Ids are scoped to the subagent; only the call needing approval is asked.
	t.deepEqual(events, [
		'begin agent-1:tc1',
		'end agent-1:tc1 ok content',
		'begin agent-1:tc2',
		'approve agent-1:tc2',
		'end agent-1:tc2 ok clean',
	]);
});

test.serial('a bridge is told when a tool fails after it was approved', async t => {
	const toolManager = createMockToolManager({
		git_status: {
			handler: async () => {
				throw new Error('Tool crashed');
			},
			readOnly: false,
			needsApproval: true,
		},
	});
	const {bridge, events} = createRecordingBridge();

	await runExploreWithBridge(toolManager, [{id: 'tc1', name: 'git_status'}], bridge);

	t.is(events[1], 'approve agent-1:tc1');
	t.true(events[2].startsWith('end agent-1:tc1 failed'));
});

test.serial('a call the bridge does not approve never runs and is settled as failed', async t => {
	for (const decision of ['denied', 'cancelled'] as const) {
		let ran = false;
		const toolManager = createMockToolManager({
			git_status: {
				handler: async () => {
					ran = true;
					return 'clean';
				},
				readOnly: false,
				needsApproval: true,
			},
		});
		const {bridge, events} = createRecordingBridge({decision});

		await runExploreWithBridge(toolManager, [{id: 'tc1', name: 'git_status'}], bridge);

		t.false(ran, `${decision}: the tool must not run`);
		t.true(events[2].startsWith('end agent-1:tc1 failed'), decision);
		t.true(
			events[2].includes(decision === 'denied' ? 'denied' : 'cancelled'),
			decision,
		);
	}
});

test.serial('approval follows the bridge session mode, not the executor mode', async t => {
	const toolManager = createMockToolManager({
		git_status: {
			handler: async () => 'clean',
			readOnly: false,
			needsApproval: true,
		},
	});
	// The executor is shared and was built in 'normal' mode, as the ACP one is;
	// the session is in yolo, where the top-level loop would not ask either.
	let globalPrompts = 0;
	setGlobalToolApprovalHandler(async () => {
		globalPrompts++;
		return true;
	});
	const {bridge, events} = createRecordingBridge({mode: 'yolo'});

	await runExploreWithBridge(toolManager, [{id: 'tc1', name: 'git_status'}], bridge);

	t.deepEqual(events, ['begin agent-1:tc1', 'end agent-1:tc1 ok clean']);
	t.is(globalPrompts, 0);

	// Restore auto-approve handler for other tests
	setGlobalToolApprovalHandler(async () => true);
});

test.serial('subagents of two sessions reach their own bridges', async t => {
	const toolManager = createMockToolManager({
		git_status: {
			handler: async () => 'clean',
			readOnly: false,
			needsApproval: true,
		},
	});
	const executorFor = () =>
		new SubagentExecutor(
			toolManager,
			createMockClient([
				{
					content: '',
					tool_calls: [{id: 'call_1', function: {name: 'git_status', arguments: '{}'}}],
				},
				{content: 'Done'},
			]),
		);
	const a = createRecordingBridge();
	const b = createRecordingBridge();
	const unregisterA = registerSubagentToolBridge('session-a', a.bridge);
	const unregisterB = registerSubagentToolBridge('session-b', b.bridge);

	try {
		await Promise.all([
			executorFor().execute(
				{subagent_type: 'explore', description: 'A'},
				undefined,
				0,
				'agent-a',
				{sessionId: 'session-a'},
			),
			executorFor().execute(
				{subagent_type: 'explore', description: 'B'},
				undefined,
				0,
				'agent-b',
				{sessionId: 'session-b'},
			),
		]);
	} finally {
		unregisterA();
		unregisterB();
	}

	// Both models called their tool `call_1`; each session saw only its own.
	t.deepEqual(a.events, [
		'begin agent-a:call_1',
		'approve agent-a:call_1',
		'end agent-a:call_1 ok clean',
	]);
	t.deepEqual(b.events, [
		'begin agent-b:call_1',
		'approve agent-b:call_1',
		'end agent-b:call_1 ok clean',
	]);
});

test.serial('a session without a bridge still uses the global approval slot', async t => {
	const toolManager = createMockToolManager({
		git_status: {
			handler: async () => 'clean',
			readOnly: false,
			needsApproval: true,
		},
	});
	const prompted: string[] = [];
	setGlobalToolApprovalHandler(async ({toolCall}) => {
		prompted.push(toolCall.id);
		return true;
	});
	const {bridge, events} = createRecordingBridge();
	// Registered for a different session than the one that runs.
	const unregister = registerSubagentToolBridge('session-other', bridge);

	try {
		const result = await new SubagentExecutor(
			toolManager,
			createMockClient([
				{
					content: '',
					tool_calls: [{id: 'tc1', function: {name: 'git_status', arguments: '{}'}}],
				},
				{content: 'Done'},
			]),
		).execute({subagent_type: 'explore', description: 'No bridge'}, undefined, 0, 'agent-1', {
			sessionId: 'session-1',
		});
		t.true(result.success);
	} finally {
		unregister();
	}

	t.deepEqual(events, []);
	t.deepEqual(prompted, ['agent-1:tc1']);

	// Restore auto-approve handler for other tests
	setGlobalToolApprovalHandler(async () => true);
});

test.serial('a bridge is told when a tool reports failure in its text', async t => {
	// Many built-in tools return "Error: ..." as plain text, not a structured
	// isError result; the top-level ACP path reads both as a failure.
	const toolManager = createMockToolManager({
		git_status: {
			handler: async () => 'Error: not a git repository',
			readOnly: false,
			needsApproval: true,
		},
	});
	const {bridge, events} = createRecordingBridge();

	await runExploreWithBridge(toolManager, [{id: 'tc1', name: 'git_status'}], bridge);

	t.is(events[2], 'end agent-1:tc1 failed Error: not a git repository');
});

test.serial('a bridge sees a call refused before it runs, settled as failed', async t => {
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'content', readOnly: true},
	});
	const {bridge, events} = createRecordingBridge();

	// explore is not offered write_file, and nothing named invented_tool exists.
	await runExploreWithBridge(
		toolManager,
		[
			{id: 'tc1', name: 'write_file'},
			{id: 'tc2', name: 'invented_tool'},
		],
		bridge,
	);

	t.is(events.length, 4);
	t.is(events[0], 'begin agent-1:tc1');
	t.true(events[1].startsWith('end agent-1:tc1 failed'));
	t.is(events[2], 'begin agent-1:tc2');
	t.true(events[3].startsWith('end agent-1:tc2 failed'));
});

test.serial('a subagent is limited to the tools of the bridge session mode', async t => {
	// The shared executor is in 'normal' mode, as the ACP one is; only the
	// session's own mode decides what its subagents may use.
	for (const [mode, shouldRun] of [
		['plan', false],
		['yolo', true],
	] as const) {
		let ran = false;
		const toolManager = createMockToolManager({
			write_file: {
				handler: async () => {
					ran = true;
					return 'written';
				},
				readOnly: false,
				needsApproval: true,
			},
		});
		const {bridge, events} = createRecordingBridge({mode});
		const unregister = registerSubagentToolBridge('session-1', bridge);

		try {
			await new SubagentExecutor(
				toolManager,
				createMockClient([
					{
						content: '',
						tool_calls: [
							{id: 'tc1', function: {name: 'write_file', arguments: '{}'}},
						],
					},
					{content: 'Done'},
				]),
			).execute(
				{subagent_type: 'explore', description: 'Write a file'},
				undefined,
				0,
				'agent-1',
				{sessionId: 'session-1'},
				{tools: ['write_file']},
			);
		} finally {
			unregister();
		}

		t.is(ran, shouldRun, mode);
		if (!shouldRun) {
			t.true(
				events[1].startsWith('end agent-1:tc1 failed Error: Tool'),
				`${mode}: ${events[1]}`,
			);
		}
	}
});

// ============================================================================
// Run lifecycle events and per-child cancel
// ============================================================================

const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION = '22222222-2222-4222-8222-222222222222';

function recordRunEvents() {
	const events: SubagentRunEvent[] = [];
	const stop = onSubagentRunEvent(event => events.push(event));
	return {events, stop};
}

/** Poll until `condition` holds; a fixed sleep is a flake waiting for a loaded CI box. */
async function waitUntil(condition: () => boolean, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error('timed out waiting');
		await new Promise(resolve => setTimeout(resolve, 10));
	}
}

/** A model call that never answers until it is aborted. */
function hangingClient(onAbort?: () => void, onStart?: () => void): LLMClient {
	const client = createMockClient([]);
	(client as any).chat = (
		_messages: unknown,
		_tools: unknown,
		_callbacks: unknown,
		signal?: AbortSignal,
	) =>
		new Promise((_resolve, reject) => {
			onStart?.();
			// A real client rejects on a signal that is already aborted, so this
			// must too: a cancel can land before the call is made.
			const abort = () => {
				onAbort?.();
				reject(new Error('Aborted'));
			};
			if (signal?.aborted) abort();
			else signal?.addEventListener('abort', abort);
		});
	return client;
}

test.serial('a run emits started, progress and completed with one stable id', async t => {
	const toolManager = createMockToolManager({
		read_file: {handler: async () => 'file contents', readOnly: true},
	});
	const client = createMockClient([
		{
			content: '',
			tool_calls: [
				{id: 'read', function: {name: 'read_file', arguments: '{"path":"a.ts"}'}},
			],
		},
		{content: 'all done'},
	]);
	const executor = new SubagentExecutor(toolManager, client);
	const {events, stop} = recordRunEvents();
	try {
		const result = await executor.execute(
			{subagent_type: 'explore', description: 'Look around'},
			undefined,
			0,
			'run-1',
			{sessionId: SESSION, toolCallId: 'parent-call'},
		);
		t.true(result.success);
	} finally {
		stop();
	}

	t.deepEqual([...new Set(events.map(e => e.childRunId))], ['run-1']);
	t.is(events[0].status, 'started');
	t.is(events.at(-1)?.status, 'completed');
	t.is(events.at(-1)?.result, 'all done');
	t.true(events.slice(1, -1).length > 0);
	t.true(events.slice(1, -1).every(e => e.status === 'progress'));
	t.true(
		events.some(e => e.lastTool === 'read_file' && (e.toolCallCount ?? 0) >= 1),
	);
	for (const event of events) {
		t.is(event.name, 'explore');
		t.is(event.sessionId, SESSION);
		t.is(event.toolCallId, 'parent-call');
		t.is(event.parentRunId, '');
	}
});

test.serial('concurrent runs each emit their own stream', async t => {
	const toolManager = createMockToolManager();
	const {events, stop} = recordRunEvents();
	try {
		await Promise.all(
			['run-a', 'run-b'].map(id =>
				new SubagentExecutor(
					toolManager,
					createMockClient([{content: `done ${id}`}]),
				).execute(
					{subagent_type: 'explore', description: id},
					undefined,
					0,
					id,
					{sessionId: SESSION},
				),
			),
		);
	} finally {
		stop();
	}

	for (const id of ['run-a', 'run-b']) {
		const own = events.filter(e => e.childRunId === id);
		t.deepEqual([own[0].status, own.at(-1)?.status], ['started', 'completed']);
		t.is(own.at(-1)?.result, `done ${id}`);
	}
});

test.serial('a nested run reports its parent run, and a run hands its own id to its tools', async t => {
	let toolContext: ToolExecutionContext | undefined;
	const toolManager = createMockToolManager({
		read_file: {
			handler: async (_args, options) => {
				toolContext = options;
				return 'x';
			},
			readOnly: true,
		},
	});
	const client = createMockClient([
		{
			content: '',
			tool_calls: [
				{id: 'inner-call', function: {name: 'read_file', arguments: '{}'}},
			],
		},
		{content: 'ok'},
	]);
	const {events, stop} = recordRunEvents();
	try {
		await new SubagentExecutor(toolManager, client).execute(
			{subagent_type: 'explore', description: 'nested'},
			undefined,
			1,
			'child-run',
			{sessionId: SESSION, subagentRunId: 'parent-run'},
		);
	} finally {
		stop();
	}

	t.true(events.length > 0);
	t.true(events.every(e => e.parentRunId === 'parent-run'));
	// A subagent started by one of these tools would name this run as its parent.
	t.is(toolContext?.subagentRunId, 'child-run');
	// Namespaced by run, so two runs' calls never share an id.
	t.true(toolContext?.toolCallId?.endsWith('inner-call'));
});

test.serial('cancelling one run ends it and leaves its sibling and the turn running', async t => {
	const toolManager = createMockToolManager();
	const turn = new AbortController();
	const siblingClient = createMockClient([]);
	let hangingStarted = false;
	let finishSibling: (() => void) | undefined;
	(siblingClient as any).chat = () =>
		new Promise(resolve => {
			finishSibling = () =>
				resolve({choices: [{message: {content: 'sibling done'}}]});
		});

	const {events, stop} = recordRunEvents();
	try {
		const cancelled = new SubagentExecutor(
			toolManager,
			hangingClient(undefined, () => {
				hangingStarted = true;
			}),
		).execute(
			{subagent_type: 'explore', description: 'a'},
			turn.signal,
			0,
			'run-cancel',
			{sessionId: SESSION},
		);
		const sibling = new SubagentExecutor(toolManager, siblingClient).execute(
			{subagent_type: 'explore', description: 'b'},
			turn.signal,
			0,
			'run-keep',
			{sessionId: SESSION},
		);
		await waitUntil(() => hangingStarted && finishSibling !== undefined);

		t.true(cancelSubagentRun(SESSION, 'run-cancel'));
		const result = await cancelled;
		t.false(result.success);
		t.is(result.error, 'Subagent was cancelled');
		t.false(turn.signal.aborted);

		finishSibling?.();
		t.true((await sibling).success);
	} finally {
		stop();
	}

	t.is(
		events.filter(e => e.childRunId === 'run-cancel').at(-1)?.status,
		'cancelled',
	);
	t.is(
		events.filter(e => e.childRunId === 'run-keep').at(-1)?.status,
		'completed',
	);
});

test.serial('a cancel that lands just before the model call is made still ends the run', async t => {
	// The first progress event fires after the loop's own aborted check and
	// before the model call, so cancelling there hands chat() a signal that is
	// already aborted. A client that only listens for the event would hang.
	const stop = onSubagentRunEvent(event => {
		if (event.status === 'progress') cancelSubagentRun(SESSION, 'run-late');
	});
	try {
		const result = await new SubagentExecutor(
			createMockToolManager(),
			hangingClient(),
		).execute(
			{subagent_type: 'explore', description: 'late'},
			undefined,
			0,
			'run-late',
			{sessionId: SESSION},
		);

		t.false(result.success);
		t.is(result.error, 'Subagent was cancelled');
	} finally {
		stop();
	}
});

test.serial('cancelling the turn cancels every run', async t => {
	const toolManager = createMockToolManager();
	const turn = new AbortController();
	let started = 0;
	const {events, stop} = recordRunEvents();
	try {
		const runs = ['run-1', 'run-2'].map(id =>
			new SubagentExecutor(
				toolManager,
				hangingClient(undefined, () => {
					started++;
				}),
			).execute(
				{subagent_type: 'explore', description: id},
				turn.signal,
				0,
				id,
				{sessionId: SESSION},
			),
		);
		await waitUntil(() => started === 2);
		turn.abort();
		const results = await Promise.all(runs);
		t.true(results.every(r => !r.success));
	} finally {
		stop();
	}

	for (const id of ['run-1', 'run-2']) {
		t.is(events.filter(e => e.childRunId === id).at(-1)?.status, 'cancelled');
	}
});

test.serial('a run of another session cannot be cancelled, and a finished run is forgotten', async t => {
	const toolManager = createMockToolManager();
	let aborted = false;
	let started = false;
	const run = new SubagentExecutor(
		toolManager,
		hangingClient(
			() => {
				aborted = true;
			},
			() => {
				started = true;
			},
		),
	).execute(
		{subagent_type: 'explore', description: 'a'},
		undefined,
		0,
		'run-scoped',
		{sessionId: SESSION},
	);
	await waitUntil(() => started);

	t.false(cancelSubagentRun(OTHER_SESSION, 'run-scoped'));
	t.false(aborted);
	t.true(cancelSubagentRun(SESSION, 'run-scoped'));
	await run;
	t.true(aborted);
	t.false(cancelSubagentRun(SESSION, 'run-scoped'));
});

test.serial('a subagent approval request carries the run id', async t => {
	const toolManager = createMockToolManager({
		git_status: {
			handler: async () => 'clean',
			readOnly: false,
			needsApproval: true,
		},
	});
	let seen: string | undefined;
	const unregister = registerSubagentToolBridge(SESSION, {
		getMode: () => 'normal',
		begin: async () => {},
		approve: async (_toolCall, _signal, subagentRunId) => {
			seen = subagentRunId;
			return 'approved';
		},
		end: async () => {},
	});
	try {
		const client = createMockClient([
			{
				content: '',
				tool_calls: [
					{id: 'tc1', function: {name: 'git_status', arguments: '{}'}},
				],
			},
			{content: 'Done'},
		]);
		await new SubagentExecutor(toolManager, client).execute(
			{subagent_type: 'explore', description: 'approval'},
			undefined,
			0,
			'run-approval',
			{sessionId: SESSION},
		);
	} finally {
		unregister();
	}
	t.is(seen, 'run-approval');
});

test.serial('a subagent started with a session\'s tool manager uses that session\'s tools', async t => {
	const calls: string[] = [];
	const sharedTools = createMockToolManager({
		read_file: {handler: async () => 'shared read', readOnly: true},
	});
	const sessionTools = createMockToolManager({
		read_file: {
			handler: async () => {
				calls.push('session');
				return 'session read';
			},
			readOnly: true,
		},
	});
	const client = createMockClient([
		{
			content: '',
			tool_calls: [{id: 'tc1', function: {name: 'read_file', arguments: '{}'}}],
		},
		{content: 'done'},
	]);
	const executor = new SubagentExecutor(sharedTools, client);

	const result = await executor.execute(
		{subagent_type: 'explore', description: 'use the session tools'},
		undefined,
		0,
		'scoped-run',
		{toolManager: sessionTools},
	);

	t.true(result.success);
	t.deepEqual(calls, ['session']);
	// The same executor, unchanged, for the next call that carries no manager.
	const plain = await executor.execute({
		subagent_type: 'explore',
		description: 'no session tools',
	});
	t.true(plain.success);
	t.deepEqual(calls, ['session']);
});
