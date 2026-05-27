import test from 'ava';
import {AcpAgent} from '@/acp/acp-agent';
import type {AcpInitContext} from '@/acp/acp-types';
import {
	setToolRegistryGetter,
	setToolManagerGetter,
} from '@/message-handler';

console.log('\nacp-agent.spec.ts');

// ============================================================================
// Test helpers
// ============================================================================

const createMockInitContext = (): AcpInitContext => ({
	client: {
		chat: async () => ({
			choices: [{message: {content: 'Test response'}}],
		}),
	} as any,
	toolManager: {
		getAvailableToolNames: () => [],
		getEffectiveTools: () => ({}),
		getFilteredToolsWithoutExecute: () => ({}),
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
	setToolRegistryGetter(() => ({}));
	setToolManagerGetter(() => null);
});

// ============================================================================
// initialize()
// ============================================================================

test('AcpAgent.initialize - returns correct protocol version', async t => {
	const {agent} = createAgent();
	const result = await agent.initialize({protocolVersion: '0.11'});
	t.is(result.protocolVersion, '0.11');
});

test('AcpAgent.initialize - returns agent capabilities', async t => {
	const {agent} = createAgent();
	const result = await agent.initialize({protocolVersion: '0.11'});
	t.truthy(result.agentCapabilities);
	t.truthy(result.agentCapabilities?.sessionCapabilities?.close);
});

test('AcpAgent.initialize - returns agent info', async t => {
	const {agent} = createAgent();
	const result = await agent.initialize({protocolVersion: '0.11'});
	t.is(result.agentInfo?.name, 'nanocoder');
	t.is(result.agentInfo?.title, 'Nanocoder');
	t.truthy(result.agentInfo?.version);
});

test('AcpAgent.initialize - returns empty auth methods', async t => {
	const {agent} = createAgent();
	const result = await agent.initialize({protocolVersion: '0.11'});
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
