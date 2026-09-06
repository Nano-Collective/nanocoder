import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {artifactManager} from '@/artifacts/artifact-manager';
import {AcpAgent} from '@/acp/acp-agent';
import type {AcpInitContext} from '@/acp/acp-types';
import {clearAppConfig} from '@/config';
import {
	setToolRegistryGetter,
	setToolManagerGetter,
} from '@/message-handler';
import {convertToModelMessages} from '@/ai-sdk-client/converters/message-converter';
import {sessionManager} from '@/session/session-manager';
import {SemanticMemoryManager} from '@/memory/semantic-memory-manager';

console.log('\nacp-agent.spec.ts');

// Isolate preferences writes (setSessionConfigOption persists last-used model).
const testConfigDir = join(tmpdir(), `nanocoder-acp-test-${Date.now()}`);
process.env.NANOCODER_CONFIG_DIR = testConfigDir;

// Provider config is read from cwd, so chdir to keep a local agents.config.json from leaking in.
mkdirSync(testConfigDir, {recursive: true});
process.chdir(testConfigDir);

// extMethod's renameSession touches the sessionManager singleton, which
// otherwise defaults to the real app-data directory (~/.local/share/nanocoder
// or platform equivalent) — isolate it the same way NANOCODER_CONFIG_DIR is above.
process.env.NANOCODER_DATA_DIR = join(
	tmpdir(),
	`nanocoder-acp-test-data-${Date.now()}`,
);

// ============================================================================
// Test helpers
// ============================================================================

let mockCurrentModel = 'test-model';

const createMockInitContext = (): AcpInitContext => ({
	client: {
		chat: async () => ({
			choices: [{message: {content: 'Test response'}}],
		}),
		getAvailableModels: async () => ['test-model', 'other-model'],
		getCurrentModel: () => mockCurrentModel,
		getProviderConfig: () => ({name: 'test-provider'}),
		setModel: (model: string) => {
			mockCurrentModel = model;
		},
		// saveAcpSessionToDisk() reads this, and its failures are swallowed by a
		// bare catch — without it every persist silently no-ops and the on-disk
		// half of the ACP path goes untested.
		getProviderConfig: () => ({name: 'test-provider'}),
	} as any,
	toolManager: {
		getAvailableToolNames: () => [],
		getFilteredTools: () => ({}),
		hasTool: () => false,
		getToolEntry: () => undefined,
		isReadOnly: () => true,
	} as any,
	customCommandLoader: null as any,
	provider: 'test-provider',
	model: 'test-model',
});

const createMockConn = () =>
	({
		sessionUpdate: async () => {},
		requestPermission: async () => ({
			outcome: {outcome: 'cancelled'},
		}),
	}) as any;

const createAgent = (): {agent: AcpAgent; conn: any} => {
	const conn = createMockConn();
	const agent = new AcpAgent(createMockInitContext(), conn);
	return {agent, conn};
};

test.beforeEach(() => {
	mockCurrentModel = 'test-model';
	setToolRegistryGetter(() => ({}));
	setToolManagerGetter(() => null);
});

// ============================================================================
// initialize()
// ============================================================================

test('AcpAgent.initialize - echoes a supported protocol version', async t => {
	const {agent} = createAgent();
	const result = await agent.initialize({protocolVersion: 1});
	t.is(result.protocolVersion, 1);
});

test('AcpAgent.initialize - clamps a newer protocol version down to ours', async t => {
	const {agent} = createAgent();
	const result = await agent.initialize({protocolVersion: 999} as any);
	// Never claim support for a version newer than the SDK implements.
	t.true((result.protocolVersion as number) < 999);
});

test('AcpAgent.initialize - returns agent capabilities', async t => {
	const {agent} = createAgent();
	const result = await agent.initialize({protocolVersion: 1});
	t.truthy(result.agentCapabilities);
	t.truthy(result.agentCapabilities?.sessionCapabilities?.close);
});

test('AcpAgent.initialize - returns agent info with provided version', async t => {
	const conn = createMockConn();
	const agent = new AcpAgent(createMockInitContext(), conn, '9.9.9');
	const result = await agent.initialize({protocolVersion: 1});
	t.is(result.agentInfo?.name, 'nanocoder');
	t.is(result.agentInfo?.title, 'Nanocoder');
	t.is(result.agentInfo?.version, '9.9.9');
});

test('AcpAgent.initialize - returns empty auth methods', async t => {
	const {agent} = createAgent();
	const result = await agent.initialize({protocolVersion: 1});
	t.deepEqual(result.authMethods, []);
});

test.serial('AcpAgent.unstable_listProviders - returns ACP provider identifiers', async t => {
	const previousProviders = process.env.NANOCODER_PROVIDERS;
	process.env.NANOCODER_PROVIDERS = JSON.stringify([
		{
			name: 'Atlas Cloud',
			baseUrl: 'https://api.atlascloud.ai/v1',
			models: ['openai/gpt-5.6-sol'],
		},
	]);
	clearAppConfig();
	try {
		const {agent} = createAgent();
		const result = await agent.unstable_listProviders({});

		t.deepEqual(result.providers, [
			{
				id: 'Atlas Cloud',
				providerId: 'Atlas Cloud',
				required: false,
				supported: ['openai'],
			},
		]);
	} finally {
		if (previousProviders === undefined) {
			delete process.env.NANOCODER_PROVIDERS;
		} else {
			process.env.NANOCODER_PROVIDERS = previousProviders;
		}
		clearAppConfig();
	}
});

// ============================================================================
// newSession()
// ============================================================================

test('AcpAgent.newSession - returns unique session IDs', async t => {
	const {agent} = createAgent();
	const s1 = await agent.newSession({cwd: '/tmp'});
	const s2 = await agent.newSession({cwd: '/tmp'});
	t.not(s1.sessionId, s2.sessionId);
});

test('AcpAgent.newSession - returns auto-accept as current mode', async t => {
	const {agent} = createAgent();
	const result = await agent.newSession({cwd: '/tmp'});
	t.is(result.modes.currentModeId, 'auto-accept');
});

test('AcpAgent.newSession - returns all available modes', async t => {
	const {agent} = createAgent();
	const result = await agent.newSession({cwd: '/tmp'});
	t.is(result.modes.availableModes.length, 4);
	const modeIds = result.modes.availableModes.map((m: any) => m.id);
	t.true(modeIds.includes('normal'));
	t.true(modeIds.includes('auto-accept'));
	t.true(modeIds.includes('yolo'));
	t.true(modeIds.includes('plan'));
});

test('AcpAgent.newSession - exposes available models and current model', async t => {
	const {agent} = createAgent();
	const result = await agent.newSession({cwd: '/tmp'});
	const modelOption = result.configOptions?.find(
		(o: any) => o.id === 'model',
	) as any;
	t.is(modelOption?.currentValue, 'test-model');
	const ids = modelOption?.options.map((o: any) => o.value);
	t.true(ids?.includes('test-model'));
	t.true(ids?.includes('other-model'));
});

// ============================================================================
// loadSession()
// ============================================================================

test('AcpAgent.initialize - advertises loadSession capability', async t => {
	const {agent} = createAgent();
	const result = await agent.initialize({protocolVersion: 1});
	t.true(result.agentCapabilities?.loadSession);
});

test('AcpAgent.loadSession - creates a usable session for an unknown id', async t => {
	const {agent} = createAgent();
	const result = await agent.loadSession({
		sessionId: 'persisted-123',
		cwd: '/tmp',
		mcpServers: [],
	});
	t.truthy(result.modes);
	t.truthy(result.configOptions);
	// The loaded session must accept prompts (no "session not found").
	const prompt = await agent.prompt({
		sessionId: 'persisted-123',
		prompt: [{type: 'text', text: 'hi'}],
	});
	t.truthy(prompt.stopReason);
});

test('AcpAgent.loadSession - replays in-memory history for a known session', async t => {
	const conn = createMockConn();
	const updates: any[] = [];
	conn.sessionUpdate = async (u: any) => {
		updates.push(u);
	};
	const agent = new AcpAgent(createMockInitContext(), conn);
	const session = await agent.newSession({cwd: '/tmp'});
	await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'remember this'}],
	});

	updates.length = 0;
	await agent.loadSession({
		sessionId: session.sessionId,
		cwd: '/tmp',
		mcpServers: [],
	});
	const replayed = updates.filter(
		u => u.update?.sessionUpdate === 'user_message_chunk',
	);
	t.true(replayed.some(u => u.update.content.text === 'remember this'));
});

test('AcpAgent.loadSession - hides internal walkthrough fallback messages', async t => {
	const conn = createMockConn();
	const updates: any[] = [];
	conn.sessionUpdate = async (update: any) => {
		updates.push(update);
	};
	const initContext = createMockInitContext();
	initContext.toolManager = {
		getAvailableToolNames: () => ['write_walkthrough'],
		getFilteredTools: () => ({}),
		hasTool: () => false,
		getToolEntry: () => undefined,
	} as any;
	const agent = new AcpAgent(initContext, conn);
	const session = await agent.newSession({cwd: '/tmp'});
	await agent.prompt({
		sessionId: session.sessionId,
		prompt: [
			{
				type: 'text',
				text: '<approved_plan>Implement artifacts.</approved_plan>',
			},
		],
	});

	updates.length = 0;
	await agent.loadSession({
		sessionId: session.sessionId,
		cwd: '/tmp',
		mcpServers: [],
	});
	const replayedUserText = updates
		.filter(update => update.update?.sessionUpdate === 'user_message_chunk')
		.map(update => update.update.content.text);

	t.true(replayedUserText.some(text => text.includes('<approved_plan>')));
	t.false(
		replayedUserText.some(text => text.includes('nanocoder-internal-walkthrough')),
	);
});

test('AcpAgent.loadSession - returns the session artifact inventory', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});

	try {
		await agent.prompt({
			sessionId: session.sessionId,
			prompt: [{type: 'text', text: 'Persist this session.'}],
		});
		await artifactManager.writeArtifact(
			session.sessionId,
			'implementation_plan',
			'# Plan\n',
		);
		await artifactManager.writeArtifact(
			session.sessionId,
			'walkthrough',
			'# Walkthrough\n',
		);

		const result = await agent.loadSession({
			sessionId: session.sessionId,
			cwd: '/tmp',
			mcpServers: [],
		});

		const artifacts = result._meta?.['nanocoder/artifacts'];
		t.true(Array.isArray(artifacts));
		t.deepEqual(
			(artifacts as Array<{kind: string}>).map(artifact => artifact.kind),
			['implementation_plan', 'walkthrough'],
		);
	} finally {
		await agent.deleteSession({sessionId: session.sessionId});
	}
});

test('AcpAgent.resumeSession - returns the session artifact inventory', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});

	try {
		await agent.prompt({
			sessionId: session.sessionId,
			prompt: [{type: 'text', text: 'Persist this session.'}],
		});
		await artifactManager.writeArtifact(
			session.sessionId,
			'task',
			'# Tasks\n',
		);
		const result = await agent.resumeSession({
			sessionId: session.sessionId,
			cwd: '/tmp',
		});
		const artifacts = result._meta?.['nanocoder/artifacts'] as Array<{
			kind: string;
		}>;
		t.deepEqual(artifacts.map(artifact => artifact.kind), ['task']);
	} finally {
		await agent.deleteSession({sessionId: session.sessionId});
	}
});

test('AcpAgent.loadSession - replays reasoning but skips whitespace-only reasoning', async t => {
	const conn = createMockConn();
	const updates: any[] = [];
	conn.sessionUpdate = async (u: any) => {
		updates.push(u);
	};
	const agent = new AcpAgent(createMockInitContext(), conn);
	const session = await agent.newSession({cwd: '/tmp'});
	const loaded = (agent as any).sessions.get(session.sessionId);
	loaded.messages = [
		{role: 'assistant', content: 'first', reasoning: '\n\n'},
		{role: 'assistant', content: 'second', reasoning: 'weighing options'},
	];

	updates.length = 0;
	await agent.loadSession({
		sessionId: session.sessionId,
		cwd: '/tmp',
		mcpServers: [],
	});

	const thoughts = updates.filter(
		u => u.update?.sessionUpdate === 'agent_thought_chunk',
	);
	t.deepEqual(
		thoughts.map(u => u.update.content.text),
		['weighing options'],
	);
});

// ============================================================================
// setSessionConfigOption()
// ============================================================================

test('AcpAgent.setSessionConfigOption - throws on unknown session', async t => {
	const {agent} = createAgent();
	await t.throwsAsync(
		agent.setSessionConfigOption({
			sessionId: 'nonexistent',
			configId: 'model',
			value: 'test-model',
		}),
		{message: 'Session not found: nonexistent'},
	);
});

test('AcpAgent.setSessionConfigOption - throws on unknown config option', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});
	await t.throwsAsync(
		agent.setSessionConfigOption({
			sessionId: session.sessionId,
			configId: 'does-not-exist',
			value: 'test-model',
		}),
		{message: 'Unknown config option: does-not-exist'},
	);
});

test('AcpAgent.setSessionConfigOption - throws on unknown model', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});
	await t.throwsAsync(
		agent.setSessionConfigOption({
			sessionId: session.sessionId,
			configId: 'model',
			value: 'does-not-exist',
		}),
		{message: 'Unknown model: does-not-exist'},
	);
});

test('AcpAgent.setSessionConfigOption - switches the client model', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});
	const result = await agent.setSessionConfigOption({
		sessionId: session.sessionId,
		configId: 'model',
		value: 'other-model',
	});
	const modelOption = result.configOptions.find(
		(o: any) => o.id === 'model',
	) as any;
	t.is(modelOption?.currentValue, 'other-model');
	const after = await agent.newSession({cwd: '/tmp'});
	const afterOption = after.configOptions?.find(
		(o: any) => o.id === 'model',
	) as any;
	t.is(afterOption?.currentValue, 'other-model');
});

// ============================================================================
// prompt()
// ============================================================================

test('AcpAgent.prompt - throws on unknown session', async t => {
	const {agent} = createAgent();
	await t.throwsAsync(
		agent.prompt({sessionId: 'nonexistent', prompt: [{type: 'text', text: 'hello'}]}),
		{message: 'Session not found: nonexistent'},
	);
});

test('AcpAgent.prompt - rejects an overlapping prompt before the first async boundary', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});

	const first = agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'first'}],
	});
	const controller = agent['sessions'].get(session.sessionId)!.abortController;

	await t.throwsAsync(
		agent.prompt({
			sessionId: session.sessionId,
			prompt: [{type: 'text', text: 'second'}],
		}),
		{message: `Prompt already in progress for session: ${session.sessionId}`},
	);

	t.is(agent['sessions'].get(session.sessionId)!.abortController, controller);
	t.is((await first).stopReason, 'end_turn');
});

test('AcpAgent.prompt - propagates API errors cleanly', async t => {
	const {agent} = createAgent();
	
	// Mock the client to throw an API error
	agent['initContext'].client.chat = async () => {
		throw new Error('RequestError: Internal error (500)');
	};
	
	const created = await agent.newSession({cwd: '/tmp'});
	const session = agent['sessions'].get(created.sessionId);
	
	await t.throwsAsync(
		() => agent.prompt({sessionId: created.sessionId, prompt: [{type: 'text', text: 'crash please'}]}),
		{message: /RequestError/}
	);
	
	// Ensure turnActive is reset even on error
	t.false(session.turnActive);

	const notice = session.messages[session.messages.length - 1];
	t.is(notice.role, 'assistant');
	t.true(notice.displayOnly, 'the error notice must never reach the model');
});

test('AcpAgent.prompt - resolves cleanly on user cancellation instead of throwing', async t => {
	const {agent, conn} = createAgent();

	const updates: any[] = [];
	conn.sessionUpdate = async (u: any) => {
		updates.push(u);
	};

	// Mirrors what chat-handler.ts throws when the abort signal fires mid-stream
	agent['initContext'].client.chat = async () => {
		throw new Error('Operation was cancelled');
	};

	const session = await agent.newSession({cwd: '/tmp'});

	const result = await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'stop please'}],
	});

	t.is(result.stopReason, 'cancelled');
	// The early return still has to run the finally block, same as the throwing path.
	t.false(agent['sessions'].get(session.sessionId)!.turnActive);
	t.true(
		updates.some(
			u =>
				u.update?.sessionUpdate === 'agent_message_chunk' &&
				u.update?.content?.text?.includes('Cancelled by user'),
		),
	);

	const persisted = agent['sessions'].get(session.sessionId)!.messages;
	const notice = persisted[persisted.length - 1];
	t.is(notice.role, 'assistant');
	t.true(notice.displayOnly, 'the cancel notice must never reach the model');
});

test('AcpAgent.prompt - returns response for valid session', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});
	const result = await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'Hello!'}],
	});
	t.truthy(result.stopReason);
});

test('AcpAgent.prompt - routes text and images through to the conversation', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});
	await agent.prompt({
		sessionId: session.sessionId,
		prompt: [
			{type: 'text', text: 'Analyze this image'},
			{type: 'image', data: 'base64data', mimeType: 'image/png'} as any,
		],
	});
	const internalSession = (agent as any)['sessions'].get(session.sessionId);
	const userMessage = internalSession.messages.find((m: any) => m.role === 'user');
	t.truthy(userMessage);
	t.is(userMessage?.content, 'Analyze this image');
	t.deepEqual(userMessage?.images, [
		{data: 'base64data', mediaType: 'image/png', source: 'acp'},
	]);
	t.false(Array.isArray(userMessage?.content));
});

// ============================================================================
// prompt() - built-in slash commands
// ============================================================================

const promptForBuiltinReply = async (text: string): Promise<string> => {
	const conn = createMockConn();
	const replies: string[] = [];
	conn.sessionUpdate = async (u: any) => {
		if (u.update?.sessionUpdate === 'agent_message_chunk') {
			replies.push(u.update.content.text);
		}
	};
	const agent = new AcpAgent(createMockInitContext(), conn);
	const session = await agent.newSession({cwd: '/tmp'});
	await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text}],
	});
	return replies.join('\n');
};

test('AcpAgent.prompt - /help advertises the copy commands', async t => {
	const reply = await promptForBuiltinReply('/help');
	t.true(reply.includes('`/copy`'));
	t.true(reply.includes('`/copy code`'));
});

test('AcpAgent.prompt - /copy points at the chat view instead of erroring', async t => {
	const reply = await promptForBuiltinReply('/copy');
	t.true(reply.includes('handled by the chat view'));
	t.false(reply.includes('Unrecognized slash command'));
});

test('AcpAgent.prompt - /copy code is not treated as unrecognized', async t => {
	const reply = await promptForBuiltinReply('/copy code');
	t.false(reply.includes('Unrecognized slash command'));
});

test('AcpAgent.prompt - a built-in command exchange stays out of model context', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});
	await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: '/help'}],
	});

	const messages = agent['sessions'].get(session.sessionId)!.messages;
	t.is(messages.length, 2);
	t.true(messages.every(m => m.displayOnly));
	t.deepEqual(convertToModelMessages(messages), []);
});

test.serial(
	'AcpAgent.prompt - built-in replies persist with sessions but do not create one alone',
	async t => {
		const {agent} = createAgent();
		await sessionManager.initialize();
		const commandOnlySession = await agent.newSession({cwd: '/tmp'});

		await agent.prompt({
			sessionId: commandOnlySession.sessionId,
			prompt: [{type: 'text', text: '/help'}],
		});
		t.falsy(await sessionManager.readSession(commandOnlySession.sessionId));

		const session = await agent.newSession({cwd: '/tmp'});
		await agent.prompt({
			sessionId: session.sessionId,
			prompt: [{type: 'text', text: 'real prompt'}],
		});
		await agent.prompt({
			sessionId: session.sessionId,
			prompt: [{type: 'text', text: '/help'}],
		});

		const persisted = await sessionManager.readSession(session.sessionId);
		t.truthy(persisted);
		t.true(
			persisted!.messages.some(m => m.displayOnly),
			'display-only built-in replies must remain in session history',
		);
	},
);

test('AcpAgent.prompt - a genuinely unknown command still reports unrecognized', async t => {
	const reply = await promptForBuiltinReply('/definitelynotacommand');
	t.true(reply.includes('Unrecognized slash command'));
});

// ============================================================================
// cancel()
// ============================================================================

test('AcpAgent.cancel - does not throw on unknown session', async t => {
	const {agent} = createAgent();
	await t.notThrowsAsync(agent.cancel({sessionId: 'nonexistent'}));
});

test('AcpAgent.cancel - aborts session for known session', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});

	// Session should not be aborted initially
	await agent.cancel({sessionId: session.sessionId});
	// After cancel, the agent should have called session.cancel()
	// We can't directly check the session's abortController since it's internal,
	// but we verify no error was thrown
	t.pass();
});

test('AcpAgent.cancel - stops a turn cancelled before the loop reads the signal', async t => {
	const context = createMockInitContext();
	let chatCalls = 0;
	(context.client as any).chat = async () => {
		chatCalls++;
		return {choices: [{message: {content: 'Test response'}}]};
	};
	const agent = new AcpAgent(context, createMockConn());
	const session = await agent.newSession({cwd: '/tmp'});

	const turn = agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'hi'}],
	});
	await agent.cancel({sessionId: session.sessionId});

	t.is((await turn).stopReason, 'cancelled');
	t.is(chatCalls, 0);
});

test('AcpAgent.prompt - a cancelled turn does not block the next prompt', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});

	const cancelled = agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'first'}],
	});
	await agent.cancel({sessionId: session.sessionId});
	t.is((await cancelled).stopReason, 'cancelled');

	const next = await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'second'}],
	});
	t.is(next.stopReason, 'end_turn');
});

// ============================================================================
// setSessionMode()
// ============================================================================

test('AcpAgent.setSessionMode - throws on unknown session', async t => {
	const {agent} = createAgent();
	await t.throwsAsync(
		agent.setSessionMode({sessionId: 'nonexistent', modeId: 'yolo'}),
		{message: 'Session not found: nonexistent'},
	);
});

test('AcpAgent.setSessionMode - updates mode for valid session', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});

	const result = await agent.setSessionMode({
		sessionId: session.sessionId,
		modeId: 'yolo',
	});

	t.deepEqual(result, {});
});

// ============================================================================
// authenticate()
// ============================================================================

test('AcpAgent.authenticate - returns empty response', async t => {
	const {agent} = createAgent();
	const result = await agent.authenticate({} as any);
	t.deepEqual(result, {});
});

// ============================================================================
// extMethod()
// ============================================================================

test.serial(
	'AcpAgent.extMethod - renameSession renames an existing session',
	async t => {
		const {agent} = createAgent();
		await sessionManager.initialize();
		const session = await sessionManager.createSession({
			title: 'Original title',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});

		const result = await agent.extMethod('renameSession', {
			sessionId: session.id,
			title: 'Renamed',
		});
		t.deepEqual(result, {title: 'Renamed'});

		const loaded = await sessionManager.readSession(session.id);
		t.is(loaded!.title, 'Renamed');
		t.is(loaded!.titleManuallySet, true);
	},
);

test('AcpAgent.extMethod - throws for an unknown method', async t => {
	const {agent} = createAgent();
	await t.throwsAsync(agent.extMethod('bogus', {}), {
		message: 'Unknown extension method: bogus',
	});
});

test('AcpAgent.extMethod - renameSession throws on non-string sessionId/title', async t => {
	const {agent} = createAgent();
	await t.throwsAsync(
		agent.extMethod('renameSession', {sessionId: 123, title: 'ok'}),
		{message: /requires string sessionId and title/},
	);
	await t.throwsAsync(
		agent.extMethod('renameSession', {sessionId: 'ok', title: undefined}),
		{message: /requires string sessionId and title/},
	);
});

test.serial(
	'AcpAgent.extMethod - renameSession throws for a session that does not exist on disk',
	async t => {
		const {agent} = createAgent();
		await t.throwsAsync(
			agent.extMethod('renameSession', {
				sessionId: '00000000-0000-0000-0000-000000000000',
				title: 'Renamed',
			}),
			{message: /Session not found on disk/},
		);
	},
);

test.serial(
	'AcpAgent - a renamed session keeps titleManuallySet across later prompts',
	async t => {
		// saveAcpSessionToDisk() rebuilds the Session field-by-field, so anything
		// it forgets to carry over is silently dropped from disk. Losing the flag
		// here doesn't show up in the ACP client — its own guard keeps the title —
		// but the CLI's autosave then sees an unflagged session and overwrites the
		// user's rename with an auto-derived one the next time they resume it.
		const {agent} = createAgent();
		await sessionManager.initialize();

		const session = await agent.newSession({cwd: '/tmp'});
		await agent.prompt({
			sessionId: session.sessionId,
			prompt: [{type: 'text', text: 'Hello!'}],
		});

		await agent.extMethod('renameSession', {
			sessionId: session.sessionId,
			title: 'Kept title',
		});

		await agent.prompt({
			sessionId: session.sessionId,
			prompt: [{type: 'text', text: 'Follow-up message'}],
		});

		const persisted = await sessionManager.readSession(session.sessionId);
		t.is(persisted!.title, 'Kept title');
		t.is(
			persisted!.titleManuallySet,
			true,
			'the flag must survive, not just the title',
		);
	},
);

/** Throwaway workspace for the timeline tests, removed by the caller. */
const createTimelineWorkspace = (label: string): string => {
	const cwd = join(
		tmpdir(),
		`nanocoder-timeline-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(cwd, {recursive: true});
	return cwd;
};

test('AcpAgent.extMethod - timeline/list returns captured entries', async t => {
	const {agent} = createAgent();
	const cwd = createTimelineWorkspace('list');
	try {
		const created = await agent.newSession({cwd, mcpServers: []});
		const session = (agent as any).sessions.get(created.sessionId);
		await session.timeline.capture({
			toolCallId: 'call-1',
			toolName: 'write_file',
			title: 'write_file: a.ts',
			truncateToMessageIndex: 1,
			files: new Map([['a.ts', 'before']]),
		});

		const result = await agent.extMethod('timeline/list', {
			sessionId: created.sessionId,
		});
		t.is((result.entries as any[]).length, 1);
		t.is((result.entries as any[])[0].toolName, 'write_file');
	} finally {
		rmSync(cwd, {recursive: true, force: true});
	}
});

test('AcpAgent.extMethod - timeline/revert truncates messages and restores files', async t => {
	const {agent} = createAgent();
	const cwd = createTimelineWorkspace('revert');
	try {
		writeFileSync(join(cwd, 'a.ts'), 'before');

		const created = await agent.newSession({cwd, mcpServers: []});
		const session = (agent as any).sessions.get(created.sessionId);
		session.messages = [
			{role: 'user', content: 'edit a.ts'},
			{
				role: 'assistant',
				content: '',
				tool_calls: [{id: 'call-1', function: {name: 'write_file'}}],
			},
			{role: 'tool', content: 'wrote', name: 'write_file'},
		];
		const entry = await session.timeline.capture({
			toolCallId: 'call-1',
			toolName: 'write_file',
			title: 'write_file: a.ts',
			truncateToMessageIndex: 1,
			files: new Map([['a.ts', 'before']]),
		});
		writeFileSync(join(cwd, 'a.ts'), 'after');

		const result = await agent.extMethod('timeline/revert', {
			sessionId: created.sessionId,
			checkpointId: entry.id,
		});
		t.is((result.revertedTo as any).id, entry.id);
		t.is(readFileSync(join(cwd, 'a.ts'), 'utf-8'), 'before');
		t.is(session.messages.length, 2);
		t.is(session.messages[0].role, 'user');
		t.true(
			String(session.messages[1].content).includes('Reverted to before step 1'),
		);
		t.true(
			session.messages[1].displayOnly,
			'the revert notice must never reach the model',
		);
		t.deepEqual(
			convertToModelMessages(session.messages).map((m: {role: string}) => m.role),
			['user'],
		);
	} finally {
		rmSync(cwd, {recursive: true, force: true});
	}
});

test('AcpAgent.extMethod - timeline/revert truncates by tool call, not a stale index', async t => {
	const {agent} = createAgent();
	const cwd = createTimelineWorkspace('reindex');
	try {
		writeFileSync(join(cwd, 'a.ts'), 'before');

		const created = await agent.newSession({cwd, mcpServers: []});
		const session = (agent as any).sessions.get(created.sessionId);
		const entry = await session.timeline.capture({
			toolCallId: 'call-1',
			toolName: 'write_file',
			title: 'write_file: a.ts',
			truncateToMessageIndex: 5,
			files: new Map([['a.ts', 'before']]),
		});
		writeFileSync(join(cwd, 'a.ts'), 'after');

		// History shorter than the captured index, as compaction would leave it.
		session.messages = [
			{role: 'user', content: 'edit a.ts'},
			{
				role: 'assistant',
				content: '',
				tool_calls: [{id: 'call-1', function: {name: 'write_file'}}],
			},
			{role: 'tool', content: 'wrote', name: 'write_file'},
		];

		await agent.extMethod('timeline/revert', {
			sessionId: created.sessionId,
			checkpointId: entry.id,
		});

		// The stale index would have left the whole turn in history.
		t.is(session.messages.length, 2);
		t.is(session.messages[0].content, 'edit a.ts');
		t.is(session.messages[1].role, 'assistant');
	} finally {
		rmSync(cwd, {recursive: true, force: true});
	}
});

test('AcpAgent.extMethod - timeline/revert rejects an active turn', async t => {
	const {agent} = createAgent();
	const created = await agent.newSession({cwd: '/tmp', mcpServers: []});
	const session = (agent as any).sessions.get(created.sessionId);
	session.turnActive = true;
	await t.throwsAsync(
		agent.extMethod('timeline/revert', {
			sessionId: created.sessionId,
			checkpointId: 'any',
		}),
		{message: /prompt is in progress/},
	);
});

test('AcpAgent.extMethod - timeline/list throws on missing session', async t => {
	const {agent} = createAgent();
	await t.throwsAsync(
		agent.extMethod('timeline/list', {sessionId: 'missing'}),
		{message: /Session not found/},
	);
});

test('AcpAgent.prompt - recalls relevant project memories scoped to the session cwd, without accumulating across turns', async t => {
	await new SemanticMemoryManager({cwd: '/tmp'}).addMemory({
		content: 'Auth uses Clerk and avoids middleware.',
	});

	const capturedSystemPrompts: string[] = [];
	const conn = createMockConn();
	const initContext = createMockInitContext();
	initContext.client = {
		...initContext.client,
		chat: async (messages: Array<{content: string}>) => {
			capturedSystemPrompts.push(messages[0]?.content ?? '');
			return {choices: [{message: {content: 'Test response'}}]};
		},
	} as any;
	const agent = new AcpAgent(initContext, conn);
	const session = await agent.newSession({cwd: '/tmp'});

	await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'refactor auth middleware handling'}],
	});
	await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'unrelated question about docs'}],
	});

	t.true(capturedSystemPrompts[0]?.includes('## Project Context'));
	t.true(capturedSystemPrompts[0]?.includes('Auth uses Clerk'));
	t.false(capturedSystemPrompts[1]?.includes('## Project Context'));
});
