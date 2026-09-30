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
		messages: [],
		setMessages: () => {},
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

test('warns and ignores extra positional args beyond what the prompt declares', async t => {
	let receivedArgs: Record<string, string> | undefined;
	let warning = '';
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
				getPrompt: async (_server, _name, args) => {
					receivedArgs = args;
					return {messages: [{role: 'user', content: {type: 'text', text: 'ok'}}]};
				},
			}),
		),
	);

	await handleMCPPromptCommand(
		'mcp:gh:review',
		['nanocoder', 'extra1', 'extra2'],
		createOptions({
			onAddToChatQueue: node => {
				warning = String((node as {props?: {message?: string}})?.props?.message ?? '');
			},
		}),
	);

	t.deepEqual(receivedArgs, {repo: 'nanocoder'});
	t.regex(warning, /takes 1 argument.*ignoring extra.*extra1, extra2/);
});

test('warns when args are given to a prompt that declares none', async t => {
	let called = false;
	let warning = '';
	setToolManagerGetter(() =>
		mockToolManager(
			mockMCPClient({
				prompts: [{name: 'greet', serverName: 'docs', arguments: []}],
				getPrompt: async () => {
					called = true;
					return {messages: [{role: 'user', content: {type: 'text', text: 'hi'}}]};
				},
			}),
		),
	);

	await handleMCPPromptCommand(
		'mcp:docs:greet',
		['unexpected'],
		createOptions({
			onAddToChatQueue: node => {
				warning = String((node as {props?: {message?: string}})?.props?.message ?? '');
			},
		}),
	);

	t.true(called);
	t.regex(warning, /takes no arguments.*ignoring.*unexpected/);
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

// ============================================================================
// Regression (reviewer feedback on #1172): multi-message prompts must keep
// their per-message roles instead of being flattened into one user turn.
// ============================================================================

test('a multi-message prompt ending on a user turn splices earlier turns into history and only submits the last', async t => {
	setToolManagerGetter(() =>
		mockToolManager(
			mockMCPClient({
				prompts: [{name: 'few-shot', serverName: 'docs', arguments: []}],
				getPrompt: async () => ({
					messages: [
						{role: 'user', content: {type: 'text', text: 'example input'}},
						{role: 'assistant', content: {type: 'text', text: 'example output'}},
						{role: 'user', content: {type: 'text', text: 'real question'}},
					],
				}),
			}),
		),
	);

	let sentMessage: string | undefined;
	let sentHistory: Array<{role: string; content: string}> | undefined;
	let setMessagesCalled = false;

	const handled = await handleMCPPromptCommand(
		'mcp:docs:few-shot',
		[],
		createOptions({
			setMessages: () => {
				setMessagesCalled = true;
			},
			onHandleChatMessage: async (message, _displayValue, _images, history) => {
				sentMessage = message;
				sentHistory = history as Array<{role: string; content: string}>;
			},
		}),
	);

	t.true(handled);
	// Only the final user turn is submitted as the "next chat message" ...
	t.is(sentMessage, 'real question');
	// ... and the earlier turns arrive as separate, role-preserving messages,
	// not joined into one blob.
	t.deepEqual(sentHistory, [
		{role: 'user', content: 'example input'},
		{role: 'assistant', content: 'example output'},
	]);
	t.false(
		setMessagesCalled,
		'the user-turn path submits through onHandleChatMessage, not a direct setMessages splice',
	);
});

test('a single-message prompt is submitted with no history messages', async t => {
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

	let sentHistory: unknown;
	await handleMCPPromptCommand(
		'mcp:docs:greet',
		[],
		createOptions({
			onHandleChatMessage: async (_message, _displayValue, _images, history) => {
				sentHistory = history;
			},
		}),
	);

	t.is(sentHistory, undefined);
});

test('a prompt that does not end on a user turn is appended as history instead of a fabricated chat message', async t => {
	setToolManagerGetter(() =>
		mockToolManager(
			mockMCPClient({
				prompts: [{name: 'seed', serverName: 'docs', arguments: []}],
				getPrompt: async () => ({
					messages: [
						{role: 'user', content: {type: 'text', text: 'set the scene'}},
						{role: 'assistant', content: {type: 'text', text: 'scripted reply'}},
					],
				}),
			}),
		),
	);

	let onHandleChatMessageCalled = false;
	let newMessages: Array<{role: string; content: string}> | undefined;
	let completed = false;

	const handled = await handleMCPPromptCommand(
		'mcp:docs:seed',
		[],
		createOptions({
			messages: [],
			setMessages: msgs => {
				newMessages = msgs as Array<{role: string; content: string}>;
			},
			onHandleChatMessage: async () => {
				onHandleChatMessageCalled = true;
			},
			onCommandComplete: () => {
				completed = true;
			},
		}),
	);

	t.true(handled);
	t.false(
		onHandleChatMessageCalled,
		'there is no next user turn to submit, so no chat round-trip is triggered',
	);
	t.deepEqual(newMessages, [
		{role: 'user', content: 'set the scene'},
		{role: 'assistant', content: 'scripted reply'},
	]);
	t.true(completed);
});
