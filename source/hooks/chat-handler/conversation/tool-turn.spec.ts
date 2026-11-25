import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {createWalkthroughLifecycle} from '@/artifacts/walkthrough-lifecycle';
import {getAppConfig} from '@/config/index';
import {setToolRegistryGetter} from '@/message-handler';
import {resetSessionCwd, setProjectRoot, setSessionCwd} from '@/services/session-cwd';
import {stringReplaceTool} from '@/tools/file-ops/string-replace';
import {readFileTool} from '@/tools/read-file';
import {clearReadTracker} from '@/tools/runtime/read-tracker';
import {setGlobalToolConfirmHandler} from '@/tools/runtime/tool-confirm-queue';
import type {ToolCall, ToolHandler, ToolManager, ToolResult} from '@/types/core';
import {runToolTurn, type ToolTurnContext} from './tool-turn';

console.log('\ntool-turn.spec.ts');

const SCHEMA_TOOL = {
	inputSchema: {
		jsonSchema: {
			type: 'object',
			properties: {path: {type: 'string'}},
		},
	},
};

function call(
	id: string,
	name: string,
	args: Record<string, unknown>,
): ToolCall {
	return {id, function: {name, arguments: args}};
}

function noticeText(node: unknown): string {
	if (!node || typeof node !== 'object' || !('props' in node)) return '';
	const props = (node as {props?: {children?: unknown; dimColor?: boolean}})
		.props;
	if (!props?.dimColor) return '';
	return typeof props.children === 'string' ? props.children : '';
}

function resultFor(results: ToolResult[] | undefined, id: string): ToolResult {
	const found = results?.find(result => result.tool_call_id === id);
	if (!found) throw new Error(`missing result for ${id}`);
	return found;
}

interface Harness {
	prompts: string[];
	handlerCalls: string[];
	notices: string[];
	run: (calls: ToolCall[]) => ReturnType<typeof runToolTurn>;
}

function harness(
	t: ExecutionContext,
	options: {
		approve?: boolean;
		handlers?: Record<string, ToolHandler>;
		manager: ToolManager;
	},
): Harness {
	const prompts: string[] = [];
	const handlerCalls: string[] = [];
	const notices: string[] = [];
	const handlers: Record<string, ToolHandler> = {};
	for (const [name, handler] of Object.entries(options.handlers ?? {})) {
		handlers[name] = async (args, context) => {
			handlerCalls.push(name);
			return handler(args, context);
		};
	}

	const previousAllow = getAppConfig().alwaysAllow;
	getAppConfig().alwaysAllow = [];
	setToolRegistryGetter(() => handlers);
	const restoreConfirm = setGlobalToolConfirmHandler(async pending => {
		prompts.push(pending.toolCall.function.name);
		return options.approve ?? false;
	});
	t.teardown(() => {
		restoreConfirm();
		setToolRegistryGetter(() => ({}));
		getAppConfig().alwaysAllow = previousAllow;
		clearReadTracker();
	});

	const context: ToolTurnContext = {
		toolManager: options.manager,
		signal: new AbortController().signal,
		addToChatQueue: node => {
			const text = noticeText(node);
			if (text) notices.push(text);
		},
		setIsGenerating: () => {},
		conversationStateManager: {
			current: {updateAfterToolExecution: () => {}},
		} as ToolTurnContext['conversationStateManager'],
		developmentMode: 'normal',
		nonInteractiveMode: false,
		currentProvider: 'test',
		currentModel: 'test',
		walkthroughLifecycle: createWalkthroughLifecycle([]),
		turnStartMessages: [],
		availableNames: [],
		notOfferedReason: () => undefined,
		flushAll: async () => {},
		markLiveTaskUpdates: () => {},
	};

	return {
		prompts,
		handlerCalls,
		notices,
		run: calls => runToolTurn(calls, context),
	};
}

function editManager(): ToolManager {
	return {
		getToolEntry: (name: string) => {
			if (name === 'read_file') {
				return {name, tool: readFileTool.tool, readOnly: true};
			}
			if (name === 'string_replace') {
				return {
					name,
					tool: stringReplaceTool.tool,
					validator: stringReplaceTool.validator,
					approval: stringReplaceTool.approval,
				};
			}
			return undefined;
		},
		getToolValidator: (name: string) =>
			name === 'string_replace' ? stringReplaceTool.validator : undefined,
		getToolFormatter: () => undefined,
		isReadOnly: (name: string) => name === 'read_file',
	} as unknown as ToolManager;
}

async function withFile(t: ExecutionContext): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), 'precheck-tool-'));
	const previousCwd = process.cwd();
	setProjectRoot(dir);
	setSessionCwd(dir);
	process.chdir(dir);
	await writeFile(join(dir, 'a.txt'), 'Hello\n', 'utf-8');
	clearReadTracker();
	t.teardown(async () => {
		process.chdir(previousCwd);
		resetSessionCwd();
		clearReadTracker();
		await rm(dir, {recursive: true, force: true});
	});
}

const replaceArgs = {path: 'a.txt', old_str: 'Hello', new_str: 'Hi'};

test('an unread string_replace is rejected without a prompt or a handler call', async t => {
	await withFile(t);
	const run = harness(t, {
		approve: true,
		manager: editManager(),
		handlers: {
			string_replace: async () => 'edited',
		},
	});

	const outcome = await run.run([call('edit-1', 'string_replace', replaceArgs)]);

	t.deepEqual(run.prompts, [], 'confirm must not be signalled');
	t.deepEqual(run.handlerCalls, [], 'the handler must not run');
	t.is(outcome.kind, 'continue');
	if (outcome.kind !== 'continue') return;
	const result = resultFor(outcome.results, 'edit-1');
	t.true(result.isError);
	t.true(result.content.startsWith('⚒ Validation failed:'));
	t.true(result.content.includes('must read'));
	t.true(result.content.includes('a.txt'));
	t.true(
		run.notices.some(
			notice =>
				notice.startsWith('string_replace rejected:') &&
				notice.includes('must read'),
		),
	);
});

test('read_file then string_replace in the same turn still prompts', async t => {
	await withFile(t);
	const run = harness(t, {
		approve: false,
		manager: editManager(),
		handlers: {
			read_file: async args =>
				(readFileTool.tool as {execute: ToolHandler}).execute(args, {
					toolCallId: 'read',
					messages: [],
				}),
			string_replace: async () => 'edited',
		},
	});

	const outcome = await run.run([
		call('read-1', 'read_file', {path: 'a.txt'}),
		call('edit-1', 'string_replace', replaceArgs),
	]);

	t.deepEqual(run.prompts, ['string_replace']);
	t.true(run.handlerCalls.includes('read_file'));
	t.false(run.handlerCalls.includes('string_replace'));
	t.is(outcome.kind, 'stop');
	if (outcome.kind !== 'stop') return;
	t.is(outcome.payload, 'declined');
});

test('a wrong-typed argument is a schema error and does not prompt', async t => {
	let validatorRan = false;
	const manager = {
		getToolEntry: () => ({tool: SCHEMA_TOOL, approval: true}),
		getToolValidator: () => async () => {
			validatorRan = true;
			return {valid: true as const};
		},
		getToolFormatter: () => undefined,
		isReadOnly: () => false,
	} as unknown as ToolManager;
	const run = harness(t, {
		approve: true,
		manager,
		handlers: {schema_tool: async () => 'ran'},
	});

	const outcome = await run.run([
		call('bad-1', 'schema_tool', {path: {nested: true}}),
	]);

	t.deepEqual(run.prompts, []);
	t.deepEqual(run.handlerCalls, []);
	t.false(validatorRan);
	t.is(outcome.kind, 'continue');
	if (outcome.kind !== 'continue') return;
	const result = resultFor(outcome.results, 'bad-1');
	t.true(result.isError);
	t.true(result.content.includes('wrong type'));
	t.true(result.content.includes('`path`'));
	t.true(
		run.notices.some(notice => notice.startsWith('schema_tool rejected:')),
	);
});

test('a valid call still prompts and declining reports cancellation', async t => {
	const manager = {
		getToolEntry: () => ({tool: SCHEMA_TOOL, approval: true}),
		getToolValidator: () => async () => ({valid: true as const}),
		getToolFormatter: () => undefined,
		isReadOnly: () => false,
	} as unknown as ToolManager;
	const run = harness(t, {
		approve: false,
		manager,
		handlers: {schema_tool: async () => 'ran'},
	});

	const outcome = await run.run([call('ok-1', 'schema_tool', {path: 'a.txt'})]);

	t.deepEqual(run.prompts, ['schema_tool']);
	t.deepEqual(run.handlerCalls, []);
	t.is(outcome.kind, 'stop');
	if (outcome.kind !== 'stop') return;
	t.is(outcome.payload, 'declined');
	const result = resultFor(outcome.results, 'ok-1');
	t.true(result.content.toLowerCase().includes('cancelled'));
});
