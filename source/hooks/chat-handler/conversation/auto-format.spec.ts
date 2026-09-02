import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {getAppConfig} from '@/config/index';
import {setToolRegistryGetter} from '@/message-handler.js';
import type {AutoFormatConfig} from '@/types/config';
import type {LLMChatResponse, Message, ToolCall, ToolResult} from '@/types/core';
import {resetShutdownManager} from '@/utils/shutdown/shutdown-manager.js';
import {runAutoFormat} from './auto-format.js';
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
	args: Record<string, unknown>,
): ToolCall => ({
	id,
	function: {name, arguments: args as ToolCall['function']['arguments']},
});

const toolResult = (
	toolCallId: string,
	name: string,
	content = 'ok',
): ToolResult => ({tool_call_id: toolCallId, role: 'tool', name, content});

function makeTempDir(): string {
	return mkdtempSync(join(tmpdir(), 'nanocoder-auto-format-'));
}

function baseConfig(
	overrides: Partial<AutoFormatConfig> = {},
): AutoFormatConfig {
	return {enabled: true, formatters: [], timeoutMs: 10_000, ...overrides};
}

test('returns no outcomes when auto-format is disabled', async t => {
	const dir = makeTempDir();
	try {
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'const a=1;');
		const outcomes = await runAutoFormat(
			[toolCall('call_1', 'write_file', {path: file})],
			[toolResult('call_1', 'write_file')],
			baseConfig({
				enabled: false,
				formatters: [{extensions: ['ts'], command: 'true'}],
			}),
			dir,
		);
		t.deepEqual(outcomes, []);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('returns no outcomes when no formatters are configured', async t => {
	const dir = makeTempDir();
	try {
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'const a=1;');
		const outcomes = await runAutoFormat(
			[toolCall('call_1', 'write_file', {path: file})],
			[toolResult('call_1', 'write_file')],
			baseConfig(),
			dir,
		);
		t.deepEqual(outcomes, []);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('skips files with no matching formatter extension', async t => {
	const dir = makeTempDir();
	try {
		const file = join(dir, 'a.py');
		writeFileSync(file, 'x=1');
		const outcomes = await runAutoFormat(
			[toolCall('call_1', 'write_file', {path: file})],
			[toolResult('call_1', 'write_file')],
			baseConfig({formatters: [{extensions: ['ts'], command: 'true'}]}),
			dir,
		);
		t.deepEqual(outcomes, []);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('ignores edits that failed or were cancelled', async t => {
	const dir = makeTempDir();
	try {
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'const a=1;');
		const outcomes = await runAutoFormat(
			[toolCall('call_1', 'write_file', {path: file})],
			[toolResult('call_1', 'write_file', 'Error: no permissions')],
			baseConfig({formatters: [{extensions: ['ts'], command: 'true'}]}),
			dir,
		);
		t.deepEqual(outcomes, []);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('runs the matching formatter against an edited file and substitutes {file}', async t => {
	const dir = makeTempDir();
	try {
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'const a=1;');
		const command =
			'node -e "require(\'fs\').appendFileSync(process.argv[1], \':formatted\')" {file}';

		const outcomes = await runAutoFormat(
			[toolCall('call_1', 'write_file', {path: file})],
			[toolResult('call_1', 'write_file')],
			baseConfig({formatters: [{extensions: ['ts'], command}]}),
			dir,
		);

		t.is(outcomes.length, 1);
		t.true(outcomes[0]?.success);
		t.is(outcomes[0]?.path, file);
		t.is(readFileSync(file, 'utf-8'), 'const a=1;:formatted');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('resolves a relative edited path against cwd before formatting', async t => {
	const dir = makeTempDir();
	try {
		writeFileSync(join(dir, 'a.ts'), 'const a=1;');
		const command =
			'node -e "require(\'fs\').appendFileSync(process.argv[1], \':formatted\')" {file}';

		const outcomes = await runAutoFormat(
			[toolCall('call_1', 'write_file', {path: 'a.ts'})],
			[toolResult('call_1', 'write_file')],
			baseConfig({formatters: [{extensions: ['ts'], command}]}),
			dir,
		);

		t.true(outcomes[0]?.success);
		t.is(readFileSync(join(dir, 'a.ts'), 'utf-8'), 'const a=1;:formatted');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('reports a non-zero exit as a failed outcome without throwing', async t => {
	const dir = makeTempDir();
	try {
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'const a=1;');
		const outcomes = await runAutoFormat(
			[toolCall('call_1', 'write_file', {path: file})],
			[toolResult('call_1', 'write_file')],
			baseConfig({
				formatters: [
					{extensions: ['ts'], command: 'node -e "process.exit(1)"'},
				],
			}),
			dir,
		);

		t.is(outcomes.length, 1);
		t.false(outcomes[0]?.success);
		t.true(outcomes[0]?.error?.includes('exited with code 1'));
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('reports a missing binary as a failed outcome without throwing', async t => {
	const dir = makeTempDir();
	try {
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'const a=1;');
		const outcomes = await runAutoFormat(
			[toolCall('call_1', 'write_file', {path: file})],
			[toolResult('call_1', 'write_file')],
			baseConfig({
				formatters: [
					{extensions: ['ts'], command: 'this-binary-does-not-exist {file}'},
				],
			}),
			dir,
		);

		t.is(outcomes.length, 1);
		t.false(outcomes[0]?.success);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('reports a timeout as a failed outcome and kills the process', async t => {
	const dir = makeTempDir();
	try {
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'const a=1;');
		const outcomes = await runAutoFormat(
			[toolCall('call_1', 'write_file', {path: file})],
			[toolResult('call_1', 'write_file')],
			baseConfig({
				timeoutMs: 100,
				formatters: [
					{extensions: ['ts'], command: 'node -e "setTimeout(()=>{}, 5000)"'},
				],
			}),
			dir,
		);

		t.is(outcomes.length, 1);
		t.false(outcomes[0]?.success);
		t.true(outcomes[0]?.error?.includes('timed out'));
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('formats each edited file with its own matching formatter', async t => {
	const dir = makeTempDir();
	try {
		const tsFile = join(dir, 'a.ts');
		const pyFile = join(dir, 'b.py');
		writeFileSync(tsFile, 'ts');
		writeFileSync(pyFile, 'py');
		const markerCommand = (suffix: string) =>
			`node -e "require('fs').appendFileSync(process.argv[1], '${suffix}')" {file}`;

		const outcomes = await runAutoFormat(
			[
				toolCall('call_1', 'write_file', {path: tsFile}),
				toolCall('call_2', 'write_file', {path: pyFile}),
			],
			[toolResult('call_1', 'write_file'), toolResult('call_2', 'write_file')],
			baseConfig({
				formatters: [
					{extensions: ['ts'], command: markerCommand(':ts-formatted')},
					{extensions: ['py'], command: markerCommand(':py-formatted')},
				],
			}),
			dir,
		);

		t.is(outcomes.length, 2);
		t.true(outcomes.every(outcome => outcome.success));
		t.is(readFileSync(tsFile, 'utf-8'), 'ts:ts-formatted');
		t.is(readFileSync(pyFile, 'utf-8'), 'py:py-formatted');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('never runs a formatter twice for the same command template with a filename containing a single quote', async t => {
	const dir = makeTempDir();
	try {
		const file = join(dir, "a'b.ts");
		writeFileSync(file, 'const a=1;');
		const command =
			'node -e "require(\'fs\').appendFileSync(process.argv[1], \':formatted\')" {file}';

		const outcomes = await runAutoFormat(
			[toolCall('call_1', 'write_file', {path: file})],
			[toolResult('call_1', 'write_file')],
			baseConfig({formatters: [{extensions: ['ts'], command}]}),
			dir,
		);

		t.true(outcomes[0]?.success);
		t.true(existsSync(file));
		t.is(readFileSync(file, 'utf-8'), 'const a=1;:formatted');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

// ============================================================================
// Wiring: processAssistantResponse runs auto-format after a successful edit
// ============================================================================

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
		getToolEntry: (name: string) => ({name, approval: false}),
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

function twoTurnClient(editToolCall: ToolCall, onSecondTurn: (messages: Message[]) => void) {
	let chatCallCount = 0;
	return {
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
			onSecondTurn(messages);
			return {
				choices: [
					{message: {role: 'assistant', content: 'Done.', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};
}

test.serial('processAssistantResponse formats an edited file after write_file succeeds', async t => {
	const dir = makeTempDir();
	try {
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'const a=1;');

		setToolRegistryGetter(() => ({
			write_file: async () => 'Edit complete',
		}));

		const editToolCall = toolCall('call_write_file', 'write_file', {path: file});
		const queued: unknown[] = [];

		const originalAutoFormat = getAppConfig().autoFormat;
		getAppConfig().autoFormat = {
			enabled: true,
			timeoutMs: 10_000,
			formatters: [
				{
					extensions: ['ts'],
					command:
						'node -e "require(\'fs\').appendFileSync(process.argv[1], \':formatted\')" {file}',
				},
			],
		};

		try {
			await processAssistantResponse(
				createLoopParams({
					client: twoTurnClient(editToolCall, () => {}),
					toolManager: createLoopToolManager(['write_file']),
					addToChatQueue: (component: unknown) => queued.push(component),
				}),
			);

			t.is(readFileSync(file, 'utf-8'), 'const a=1;:formatted');
			t.false(
				queued.some(
					component =>
						typeof component === 'object' &&
						component !== null &&
						JSON.stringify(component).includes('Auto-format failed'),
				),
			);
		} finally {
			getAppConfig().autoFormat = originalAutoFormat;
		}
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('processAssistantResponse surfaces a failed auto-format as a chat message without stopping the loop', async t => {
	const dir = makeTempDir();
	try {
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'const a=1;');

		setToolRegistryGetter(() => ({
			write_file: async () => 'Edit complete',
		}));

		const editToolCall = toolCall('call_write_file', 'write_file', {path: file});
		const queued: unknown[] = [];
		let secondTurnMessages: Message[] = [];

		const originalAutoFormat = getAppConfig().autoFormat;
		getAppConfig().autoFormat = {
			enabled: true,
			timeoutMs: 10_000,
			formatters: [
				{extensions: ['ts'], command: 'node -e "process.exit(1)"'},
			],
		};

		try {
			await processAssistantResponse(
				createLoopParams({
					client: twoTurnClient(editToolCall, messages => {
						secondTurnMessages = messages;
					}),
					toolManager: createLoopToolManager(['write_file']),
					addToChatQueue: (component: unknown) => queued.push(component),
				}),
			);

			t.true(queued.length > 0);
			// The failure is surfaced to the user, not injected into the
			// conversation the model sees.
			t.false(
				secondTurnMessages.some(
					message =>
						typeof message.content === 'string' &&
						message.content.includes('Auto-format failed'),
				),
			);
		} finally {
			getAppConfig().autoFormat = originalAutoFormat;
		}
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});
