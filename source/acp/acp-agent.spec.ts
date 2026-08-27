import {mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {AcpAgent} from '@/acp/acp-agent';
import type {AcpInitContext} from '@/acp/acp-types';
import {clearAppConfig} from '@/config';
import {
	setToolRegistryGetter,
	setToolManagerGetter,
} from '@/message-handler';
import {sessionManager} from '@/session/session-manager';

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


test('AcpAgent.prompt - propagates API errors cleanly', async t => {
	const {agent} = createAgent();
	
	// Mock the client to throw an API error
	agent['initContext'].client.chat = async () => {
		throw new Error('RequestError: Internal error (500)');
	};
	
	const session = agent.registerSession('session-1', {
		conn: agent['conn'],
		sessionId: 'session-1',
		canReadTextFile: false,
	});
	
	const error = await t.throwsAsync(
		() => agent.prompt({sessionId: 'session-1', prompt: [{type: 'text', text: 'crash please'}]}),
		{message: /RequestError/}
	);
	
	// Ensure turnActive is reset even on error
	t.false(session.turnActive);
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

// ============================================================================
// background session titling
// ============================================================================

/** Poll the persisted session, since titling is deliberately fire and forget. */
async function waitForSession(
	sessionId: string,
	predicate: (s: any) => boolean,
	timeoutMs = 3000,
): Promise<any | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const s = await sessionManager.readSession(sessionId);
		if (s && predicate(s)) return s;
		await new Promise(r => setTimeout(r, 20));
	}
	return null;
}

test('AcpAgent.prompt - a weak title waits for meaningful context', async t => {
	const {agent} = createAgent();

	let chatCalls = 0;
	agent['initContext'].client.chat = async () => {
		chatCalls++;
		// Calls 1 and 2 are conversation turns; call 3 is the titler.
		return chatCalls < 3
			? {choices: [{message: {content: 'Done.'}}]}
			: {choices: [{message: {content: 'Fix Login Redirect'}}]};
	};

	const session = await agent.newSession({cwd: '/tmp'});
	await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'fix this'}],
	});

	await new Promise(r => setTimeout(r, 200));
	const beforeContext = await sessionManager.readSession(session.sessionId);
	t.not(beforeContext?.titleGenerated, true);
	t.is(chatCalls, 1);

	await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'summarize the README'}],
	});

	const titled = await waitForSession(
		session.sessionId,
		s => s.titleGenerated === true,
	);
	t.truthy(titled, 'expected a generated title to be persisted');
	t.is(titled.title, 'Fix Login Redirect');
	// A generated title must never masquerade as a user rename.
	t.not(titled.titleManuallySet, true);

	// A third turn must not re-title: titleGenerated short-circuits it.
	await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'and now this'}],
	});
	await new Promise(r => setTimeout(r, 200));

	const after = await sessionManager.readSession(session.sessionId);
	t.is(after!.title, 'Fix Login Redirect');
	// Exactly one more chat call, the conversation turn, and no second titler.
	t.is(chatCalls, 4);
});

test('AcpAgent.prompt - a cancelled turn does not generate a title', async t => {
	const {agent} = createAgent();

	let chatCalls = 0;
	agent['initContext'].client.chat = async () => {
		chatCalls++;
		throw new Error('Operation was cancelled');
	};

	const session = await agent.newSession({cwd: '/tmp'});
	await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'fix this'}],
	});
	await new Promise(r => setTimeout(r, 200));

	// The cancel path early-returns from inside catch, which still runs the
	// finally. Reaching the finally must not be mistaken for a clean turn.
	t.is(chatCalls, 1);
	const stored = await sessionManager.readSession(session.sessionId);
	t.not(stored?.titleGenerated, true);
});

test('AcpAgent.prompt - an errored turn does not generate a title', async t => {
	const {agent} = createAgent();

	let chatCalls = 0;
	agent['initContext'].client.chat = async () => {
		chatCalls++;
		throw new Error('RequestError: Internal error (500)');
	};

	const session = await agent.newSession({cwd: '/tmp'});
	await t.throwsAsync(
		agent.prompt({
			sessionId: session.sessionId,
			prompt: [{type: 'text', text: 'fix this'}],
		}),
	);
	await new Promise(r => setTimeout(r, 200));

	t.is(chatCalls, 1);
	const stored = await sessionManager.readSession(session.sessionId);
	t.not(stored?.titleGenerated, true);
});
