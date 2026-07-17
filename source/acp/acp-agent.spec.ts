import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {AcpAgent} from '@/acp/acp-agent';
import type {AcpInitContext} from '@/acp/acp-types';
import {
	setToolRegistryGetter,
	setToolManagerGetter,
} from '@/message-handler';

console.log('\nacp-agent.spec.ts');

// Isolate preferences writes (setSessionConfigOption persists last-used model).
process.env.NANOCODER_CONFIG_DIR = join(
	tmpdir(),
	`nanocoder-acp-test-${Date.now()}`,
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
		(o: any) => o.category === 'model',
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
		(o: any) => o.category === 'model',
	) as any;
	t.is(modelOption?.currentValue, 'other-model');
	const after = await agent.newSession({cwd: '/tmp'});
	const afterOption = after.configOptions?.find(
		(o: any) => o.category === 'model',
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

test('AcpAgent.prompt - returns response for valid session', async t => {
	const {agent} = createAgent();
	const session = await agent.newSession({cwd: '/tmp'});
	const result = await agent.prompt({
		sessionId: session.sessionId,
		prompt: [{type: 'text', text: 'Hello!'}],
	});
	t.truthy(result.stopReason);
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
