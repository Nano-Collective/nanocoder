import test from 'ava';
import {SubagentExecutor} from './subagent-executor.js';
import {SubagentLoader, getSubagentLoader} from './subagent-loader.js';
import type {ToolManager} from '@/tools/tool-manager';
import type {LLMClient, LLMChatResponse} from '@/types/core';
import {setGlobalToolApprovalHandler} from '@/utils/tool-approval-queue';

console.log('\nsubagent-executor.spec.ts');

// Helper to create a mock tool manager
function createMockToolManager(
	tools: Record<string, {handler: (args: unknown) => Promise<string>; readOnly: boolean; needsApproval?: boolean}> = {},
): ToolManager {
	return {
		getAllTools: () => {
			const result: Record<string, unknown> = {};
			for (const name of Object.keys(tools)) {
				result[name] = {execute: tools[name].handler};
			}
			return result;
		},
		getAllToolsWithoutExecute: () => {
			const result: Record<string, unknown> = {};
			for (const name of Object.keys(tools)) {
				result[name] = {description: `Mock ${name} tool`};
			}
			return result;
		},
		getToolHandler: (name: string) => tools[name]?.handler,
		getToolEntry: (name: string) => {
			const tool = tools[name];
			if (!tool) return undefined;
			return {
				tool: {
					needsApproval: tool.needsApproval ?? false,
				},
			};
		},
		isReadOnly: (name: string) => tools[name]?.readOnly ?? false,
		getToolFormatter: () => undefined,
		getStreamingFormatter: () => undefined,
	} as unknown as ToolManager;
}

// Helper to create a mock LLM client
function createMockClient(
	responses: Array<{content: string; tool_calls?: Array<{id: string; function: {name: string; arguments: string}}>}>,
): LLMClient {
	let callIndex = 0;
	let currentModel = 'test-model-sonnet-v1';

	return {
		chat: async (): Promise<LLMChatResponse> => {
			const response = responses[callIndex] || {content: 'fallback'};
			callIndex++;
			return {
				choices: [{message: response}],
				toolsDisabled: false,
			} as unknown as LLMChatResponse;
		},
		getCurrentModel: () => currentModel,
		setModel: (model: string) => {
			currentModel = model;
		},
		getAvailableModels: async () => ['test-model-sonnet-v1'],
		getContextSize: () => 128000,
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

test.serial('tools needing approval are surfaced via signalToolApproval', async t => {
	const writeHandler = async () => 'written';
	const toolManager = createMockToolManager({
		write_file: {handler: writeHandler, readOnly: false, needsApproval: true},
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
				function: {name: 'write_file', arguments: '{"path": "x.ts", "content": "hello"}'},
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
	t.true(approvalRequested, 'Approval should have been requested for write_file');

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
