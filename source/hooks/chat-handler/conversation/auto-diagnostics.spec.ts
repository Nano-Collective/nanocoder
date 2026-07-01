import test from 'ava';
import {setToolRegistryGetter} from '@/message-handler.js';
import type {LLMChatResponse, Message, ToolCall, ToolResult} from '@/types/core';
import {resetShutdownManager} from '@/utils/shutdown/shutdown-manager.js';
import {
	buildAutoDiagnosticsMessage,
	collectEditedPaths,
} from './auto-diagnostics.js';
import {processAssistantResponse} from './conversation-loop.js';

test.before(() => {
	resetShutdownManager();
});

test.after.always(() => {
	resetShutdownManager();
});

const toolCall = (
	id: string,
	name: string,
	args: Record<string, unknown> | string,
): ToolCall => ({
	id,
	function: {
		name,
		arguments: args as ToolCall['function']['arguments'],
	},
});

const toolResult = (
	toolCallId: string,
	name: string,
	content = 'ok',
	overrides: Partial<ToolResult> = {},
): ToolResult => ({
	tool_call_id: toolCallId,
	role: 'tool',
	name,
	content,
	...overrides,
});

const createLoopParams = (overrides = {}) => ({
	systemMessage: {role: 'system', content: 'You are a helpful assistant'} as Message,
	messages: [{role: 'user', content: 'Hello'}] as Message[],
	client: null as any,
	toolManager: null,
	abortController: null,
	setAbortController: () => {},
	setIsGenerating: () => {},
	setStreamingReasoning: () => {},
	setStreamingContent: () => {},
	setTokenCount: () => {},
	setMessages: () => {},
	addToChatQueue: () => {},
	currentModel: 'test-model',
	currentProvider: 'openai',
	developmentMode: 'normal' as const,
	nonInteractiveMode: false,
	conversationStateManager: {
		current: {
			updateAssistantMessage: () => {},
			updateAfterToolExecution: () => {},
		},
	} as any,
	onConversationComplete: () => {},
	...overrides,
});

const createLoopToolManager = (availableTools: string[]) =>
	({
		hasTool: (name: string) => availableTools.includes(name),
		getToolNames: () => availableTools,
		getToolEntry: (name: string) => ({
			name,
			approval: false,
		}),
		getToolValidator: () => undefined,
		getToolFormatter: () => undefined,
		getAvailableToolNames: () => availableTools,
		getFilteredTools: (names: string[]) => {
			const tools: Record<string, unknown> = {};
			for (const name of names) {
				tools[name] = {
					name,
					description: `Mock tool ${name}`,
					input_schema: {type: 'object', properties: {}},
				};
			}

			return tools;
		},
		isReadOnly: () => false,
	}) as any;

async function runAutoDiagnosticsAfterEditScenario(
	editToolName: 'write_file' | 'string_replace',
	availableTools: string[],
) {
	let chatCallCount = 0;
	let editCalls = 0;
	let diagnosticsCalls = 0;
	let secondChatMessages: Message[] = [];
	const editedPath = 'source/example.ts';

	setToolRegistryGetter(() => ({
		[editToolName]: async () => {
			editCalls += 1;
			return 'Edit complete';
		},
		lsp_get_diagnostics: async (args: Record<string, unknown>) => {
			diagnosticsCalls += 1;
			return {
				llmContent: `Diagnostics for ${args.path}:\n\nERROR at line 1:1: Missing semicolon`,
				structured: {
					diagnostics: [
						{
							file: args.path,
							line: 1,
							character: 1,
							severity: 'error',
							message: 'Missing semicolon',
						},
					],
				},
			};
		},
	}));

	const editToolCall = toolCall(`call_${editToolName}`, editToolName, {
		path: editedPath,
	});
	const trackingClient = {
		chat: async (messages: Message[]): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			if (chatCallCount === 1) {
				return {
					choices: [
						{
							message: {
								role: 'assistant',
								content: '',
								tool_calls: [editToolCall],
							},
						},
					],
					toolsDisabled: false,
				};
			}

			secondChatMessages = messages;
			return {
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Done.',
							tool_calls: undefined,
						},
					},
				],
				toolsDisabled: false,
			};
		},
	};

	await processAssistantResponse(
		createLoopParams({
			client: trackingClient,
			toolManager: createLoopToolManager(availableTools),
			addToChatQueue: () => {},
		}),
	);

	return {
		chatCallCount,
		editCalls,
		diagnosticsCalls,
		secondChatMessages,
	};
}

test('collectEditedPaths returns unique paths from successful edit tools', t => {
	const paths = collectEditedPaths(
		[
			toolCall('call_1', 'write_file', {path: 'source/a.ts'}),
			toolCall('call_2', 'string_replace', '{"path":"source/b.ts"}'),
			toolCall('call_3', 'read_file', {path: 'source/c.ts'}),
			toolCall('call_4', 'write_file', {path: 'source/a.ts'}),
			toolCall('call_5', 'write_file', {file_path: 'source/d.ts'}),
		],
		[
			toolResult('call_1', 'write_file'),
			toolResult('call_2', 'string_replace'),
			toolResult('call_3', 'read_file'),
			toolResult('call_4', 'write_file'),
			toolResult('call_5', 'write_file'),
		],
	);

	t.deepEqual(paths, ['source/a.ts', 'source/b.ts', 'source/d.ts']);
});

test('collectEditedPaths skips failed or cancelled edits', t => {
	const paths = collectEditedPaths(
		[
			toolCall('call_1', 'write_file', {path: 'source/a.ts'}),
			toolCall('call_2', 'string_replace', {path: 'source/b.ts'}),
			toolCall('call_3', 'write_file', {path: 'source/c.ts'}),
		],
		[
			toolResult('call_1', 'write_file', 'Error: no permissions'),
			toolResult('call_2', 'string_replace', '⚒ Validation failed: old_str'),
			toolResult(
				'call_3',
				'write_file',
				'Tool execution was cancelled by the user.',
			),
		],
	);

	t.deepEqual(paths, []);
});

test('buildAutoDiagnosticsMessage returns null when diagnostics are clean', async t => {
	const message = await buildAutoDiagnosticsMessage(
		[toolCall('call_1', 'write_file', {path: 'source/a.ts'})],
		[toolResult('call_1', 'write_file')],
		async toolCall =>
			toolResult(
				toolCall.id,
				toolCall.function.name,
				'No diagnostics found for source/a.ts',
			),
	);

	t.is(message, null);
});

test('buildAutoDiagnosticsMessage surfaces thrown diagnostics failures', async t => {
	const message = await buildAutoDiagnosticsMessage(
		[toolCall('call_1', 'write_file', {path: 'source/a.ts'})],
		[toolResult('call_1', 'write_file')],
		async () => {
			throw new Error('diagnostics unavailable');
		},
	);

	t.truthy(message);
	t.true(message?.content.includes('Error: diagnostics unavailable'));
	t.true(message?.content.includes('source/a.ts'));
});

test('buildAutoDiagnosticsMessage surfaces error tool results', async t => {
	const message = await buildAutoDiagnosticsMessage(
		[toolCall('call_1', 'write_file', {path: 'source/a.ts'})],
		[toolResult('call_1', 'write_file')],
		async toolCall =>
			toolResult(
				toolCall.id,
				toolCall.function.name,
				'Error: LSP server crashed',
			),
	);

	t.truthy(message);
	t.true(message?.content.includes('Error: LSP server crashed'));
	t.true(message?.content.includes('source/a.ts'));
});

test('buildAutoDiagnosticsMessage identifies the path for diagnostics failures across multiple edits', async t => {
	const message = await buildAutoDiagnosticsMessage(
		[
			toolCall('call_1', 'write_file', {path: 'source/a.ts'}),
			toolCall('call_2', 'write_file', {path: 'source/b.ts'}),
		],
		[
			toolResult('call_1', 'write_file'),
			toolResult('call_2', 'write_file'),
		],
		async toolCall => {
			const args = toolCall.function.arguments;
			if (args.path === 'source/a.ts') {
				return toolResult(
					toolCall.id,
					toolCall.function.name,
					'No diagnostics found for source/a.ts',
				);
			}

			return toolResult(
				toolCall.id,
				toolCall.function.name,
				'Error: LSP server crashed',
			);
		},
	);

	t.truthy(message);
	t.true(
		message?.content.includes('Diagnostics for source/b.ts:\nError: LSP'),
	);
	t.true(message?.content.includes('- source/b.ts'));
	t.false(message?.content.includes('Paths needing attention:\n- source/a.ts'));
});

test('buildAutoDiagnosticsMessage surfaces unexpected diagnostic tool names', async t => {
	const message = await buildAutoDiagnosticsMessage(
		[toolCall('call_1', 'write_file', {path: 'source/a.ts'})],
		[toolResult('call_1', 'write_file')],
		async toolCall =>
			toolResult(
				toolCall.id,
				'unexpected_tool',
				'No diagnostics found for source/a.ts',
			),
	);

	t.truthy(message);
	t.true(
		message?.content.includes(
			'expected lsp_get_diagnostics but received unexpected_tool',
		),
	);
});

test('buildAutoDiagnosticsMessage ignores non-actionable info diagnostics', async t => {
	const message = await buildAutoDiagnosticsMessage(
		[toolCall('call_1', 'write_file', {path: 'source/a.ts'})],
		[toolResult('call_1', 'write_file')],
		async toolCall =>
			toolResult(
				toolCall.id,
				toolCall.function.name,
				'Diagnostics for source/a.ts:\n\nINFO at line 1:1: Consider renaming',
				{
					structuredContent: {
						diagnostics: [
							{
								file: 'source/a.ts',
								line: 1,
								character: 1,
								severity: 'info',
								message: 'Consider renaming',
							},
						],
					},
				},
			),
	);

	t.is(message, null);
});

test('buildAutoDiagnosticsMessage asks the model to fix reported diagnostics', async t => {
	const message = await buildAutoDiagnosticsMessage(
		[toolCall('call_1', 'write_file', {path: 'source/a.ts'})],
		[toolResult('call_1', 'write_file')],
		async toolCall =>
			toolResult(
				toolCall.id,
				toolCall.function.name,
				'Diagnostics for source/a.ts:\n\nERROR at line 1:1: Missing semicolon',
				{
					structuredContent: {
						diagnostics: [
							{
								file: 'source/a.ts',
								line: 1,
								character: 1,
								severity: 'error',
								message: 'Missing semicolon',
							},
						],
					},
				},
			),
	);

	t.truthy(message);
	if (!message) {
		t.fail('Expected diagnostics message');
		return;
	}

	t.is(message.role, 'user');
	t.true(message.content.includes('Automatic diagnostics'));
	t.true(message.content.includes('source/a.ts'));
	t.true(message.content.includes('Missing semicolon'));
});

test.serial('processAssistantResponse auto-runs diagnostics after successful write_file before the next model turn', async t => {
	const result = await runAutoDiagnosticsAfterEditScenario('write_file', [
		'write_file',
		'lsp_get_diagnostics',
	]);

	t.is(result.chatCallCount, 2);
	t.is(result.editCalls, 1);
	t.is(result.diagnosticsCalls, 1);
	const automaticDiagnosticsMessage = result.secondChatMessages.find(
		message =>
			message.role === 'user' &&
			typeof message.content === 'string' &&
			message.content.includes('Automatic diagnostics'),
	);
	t.truthy(automaticDiagnosticsMessage);
	t.true(
		typeof automaticDiagnosticsMessage?.content === 'string' &&
			automaticDiagnosticsMessage.content.includes('Missing semicolon'),
	);
});

test.serial('processAssistantResponse auto-runs diagnostics after successful string_replace before the next model turn', async t => {
	const result = await runAutoDiagnosticsAfterEditScenario('string_replace', [
		'string_replace',
		'lsp_get_diagnostics',
	]);

	t.is(result.chatCallCount, 2);
	t.is(result.editCalls, 1);
	t.is(result.diagnosticsCalls, 1);
	t.true(
		result.secondChatMessages.some(
			message =>
				message.role === 'user' &&
				typeof message.content === 'string' &&
				message.content.includes('Automatic diagnostics'),
		),
	);
});

test.serial('processAssistantResponse skips auto diagnostics when diagnostics tool is filtered out', async t => {
	const result = await runAutoDiagnosticsAfterEditScenario('write_file', [
		'write_file',
	]);

	t.is(result.chatCallCount, 2);
	t.is(result.editCalls, 1);
	t.is(result.diagnosticsCalls, 0);
	t.false(
		result.secondChatMessages.some(
			message =>
				message.role === 'user' &&
				typeof message.content === 'string' &&
				message.content.includes('Automatic diagnostics'),
		),
	);
});
