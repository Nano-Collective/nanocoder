import test from 'ava';
import {setToolManagerGetter} from '@/message-handler';
import type {MessageSubmissionOptions} from '@/types';
import {handleMCPPromptCommand} from './mcp-prompt-handler.js';

console.log('\nmcp-prompt-handler.spec.ts');

test.afterEach(() => {
	setToolManagerGetter(() => null);
});

function mockToolManager(mcpClient: unknown) {
	return {getMCPClient: () => mcpClient} as any;
}

function mockMCPClient(opts: {
	prompts: Array<{
		name: string;
		serverName: string;
		arguments?: Array<{name: string; required?: boolean}>;
	}>;
	getPrompt?: (
		serverName: string,
		name: string,
		args?: Record<string, string>,
	) => Promise<{
		description?: string;
		messages: Array<{
			role: string;
			content: {type: string; text?: string; mimeType?: string};
		}>;
	}>;
}) {
	return {
		getAllPrompts: () => opts.prompts,
		getPrompt: opts.getPrompt,
	} as any;
}

function createOptions(overrides: Partial<MessageSubmissionOptions> = {}) {
	return {
		onAddToChatQueue: () => {},
		onCommandComplete: () => {},
		onHandleChatMessage: async () => {},
		...overrides,
	} as MessageSubmissionOptions;
}

test('returns false when no MCP client is connected', async t => {
	setToolManagerGetter(() => null);

	const handled = await handleMCPPromptCommand(
		'mcp:server:greet',
		[],
		createOptions(),
	);

	t.false(handled);
});

test('returns false when the command name matches no connected prompt', async t => {
	setToolManagerGetter(() =>
		mockToolManager(mockMCPClient({prompts: [{name: 'greet', serverName: 'a'}]})),
	);

	const handled = await handleMCPPromptCommand(
		'mcp:a:not-a-prompt',
		[],
		createOptions(),
	);

	t.false(handled);
});

test('sends the resolved prompt text as the next chat message', async t => {
	let sentPrompt: string | undefined;
	setToolManagerGetter(() =>
		mockToolManager(
			mockMCPClient({
				prompts: [{name: 'greet', serverName: 'docs', arguments: []}],
				getPrompt: async () => ({
					messages: [{role: 'user', content: {type: 'text', text: 'hello there'}}],
				}),
			}),
		),
	);

	const handled = await handleMCPPromptCommand(
		'mcp:docs:greet',
		[],
		createOptions({
			onHandleChatMessage: async prompt => {
				sentPrompt = prompt;
			},
		}),
	);

	t.true(handled);
	t.is(sentPrompt, 'hello there');
});

test('maps positional args onto the prompt arguments in declared order (not all onto the first)', async t => {
	let receivedArgs: Record<string, string> | undefined;
	setToolManagerGetter(() =>
		mockToolManager(
			mockMCPClient({
				prompts: [
					{
						name: 'review',
						serverName: 'gh',
						arguments: [
							{name: 'repo', required: true},
							{name: 'pr', required: true},
						],
					},
				],
				getPrompt: async (_server, _name, args) => {
					receivedArgs = args;
					return {messages: [{role: 'user', content: {type: 'text', text: 'ok'}}]};
				},
			}),
		),
	);

	await handleMCPPromptCommand(
		'mcp:gh:review',
		['nanocoder', '42'],
		createOptions(),
	);

	t.deepEqual(receivedArgs, {repo: 'nanocoder', pr: '42'});
});

test('reports missing required arguments without calling the server', async t => {
	let called = false;
	let queuedMessage = '';
	setToolManagerGetter(() =>
		mockToolManager(
			mockMCPClient({
				prompts: [
					{
						name: 'review',
						serverName: 'gh',
						arguments: [{name: 'repo', required: true}],
					},
				],
				getPrompt: async () => {
					called = true;
					return {messages: []};
				},
			}),
		),
	);

	const handled = await handleMCPPromptCommand(
		'mcp:gh:review',
		[],
		createOptions({
			onAddToChatQueue: node => {
				queuedMessage = String((node as {props?: {message?: string}})?.props?.message ?? '');
			},
		}),
	);

	t.true(handled);
	t.false(called);
	t.regex(queuedMessage, /Missing required argument.*repo/);
});

test('routes to the prompt bound server, not just the first server with a matching name', async t => {
	let calledServer: string | undefined;
	setToolManagerGetter(() =>
		mockToolManager(
			mockMCPClient({
				prompts: [
					{name: 'summarize', serverName: 'server-a', arguments: []},
					{name: 'summarize', serverName: 'server-b', arguments: []},
				],
				getPrompt: async serverName => {
					calledServer = serverName;
					return {messages: [{role: 'user', content: {type: 'text', text: 'ok'}}]};
				},
			}),
		),
	);

	await handleMCPPromptCommand('mcp:server-b:summarize', [], createOptions());

	t.is(calledServer, 'server-b');
});

test('reports a server error instead of throwing', async t => {
	let queuedMessage = '';
	setToolManagerGetter(() =>
		mockToolManager(
			mockMCPClient({
				prompts: [{name: 'greet', serverName: 'docs', arguments: []}],
				getPrompt: async () => {
					throw new Error('server unreachable');
				},
			}),
		),
	);

	const handled = await handleMCPPromptCommand(
		'mcp:docs:greet',
		[],
		createOptions({
			onAddToChatQueue: node => {
				queuedMessage = String((node as {props?: {message?: string}})?.props?.message ?? '');
			},
		}),
	);

	t.true(handled);
	t.regex(queuedMessage, /server unreachable/);
});
