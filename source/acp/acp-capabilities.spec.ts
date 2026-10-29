import test from 'ava';
import {
	acpMcpServersToConfig,
	acpModeToDevelopmentMode,
	developmentModeToAcpMode,
	getAgentCapabilities,
	getAvailableModes,
} from '@/acp/acp-capabilities';

console.log('\nacp-capabilities.spec.ts');

// ============================================================================
// getAgentCapabilities
// ============================================================================

test('getAgentCapabilities - returns session capabilities with close', t => {
	const caps = getAgentCapabilities();
	t.deepEqual(caps, {
		loadSession: true,
		// http only: stdio is the baseline and there is no SSE transport.
		mcpCapabilities: {http: true},
		providers: {},
		sessionCapabilities: {
			close: {},
			delete: {},
			list: {},
			resume: {},
		},
		_meta: {
			nanocoder: {
				extMethods: [
					'_nanocoder/renameSession',
					'_nanocoder/timeline/list',
					'_nanocoder/timeline/revert',
					'_nanocoder/retryTurn',
					'_nanocoder/cancelSubagent',
				],
				extNotifications: [
					'_nanocoder/sessionTitleChanged',
					'_nanocoder/subagent',
				],
			},
		},
	});
});

// ============================================================================
// getAvailableModes
// ============================================================================

test('getAvailableModes - returns all five modes in order', t => {
	const modes = getAvailableModes();
	t.deepEqual(modes, ['normal', 'auto-accept', 'yolo', 'plan', 'architect']);
});

// ============================================================================
// acpModeToDevelopmentMode
// ============================================================================

test('acpModeToDevelopmentMode - maps normal', t => {
	t.is(acpModeToDevelopmentMode('normal'), 'normal');
});

test('acpModeToDevelopmentMode - maps auto-accept', t => {
	t.is(acpModeToDevelopmentMode('auto-accept'), 'auto-accept');
});

test('acpModeToDevelopmentMode - maps yolo', t => {
	t.is(acpModeToDevelopmentMode('yolo'), 'yolo');
});

test('acpModeToDevelopmentMode - maps plan', t => {
	t.is(acpModeToDevelopmentMode('plan'), 'plan');
});

test('acpModeToDevelopmentMode - rejects an unknown mode as invalid params', t => {
	// "constructor" and "toString" exist on every object, so a plain lookup
	// would have accepted them.
	for (const modeId of ['norml', '', 'constructor', 'toString', '__proto__']) {
		const error = t.throws(() => acpModeToDevelopmentMode(modeId));
		t.is((error as {code?: number}).code, -32602, modeId);
	}
});

// ============================================================================
// developmentModeToAcpMode
// ============================================================================

test('developmentModeToAcpMode - maps headless to auto-accept', t => {
	t.is(developmentModeToAcpMode('headless'), 'auto-accept');
});

test('developmentModeToAcpMode - passes through standard modes', t => {
	t.is(developmentModeToAcpMode('normal'), 'normal');
	t.is(developmentModeToAcpMode('auto-accept'), 'auto-accept');
	t.is(developmentModeToAcpMode('yolo'), 'yolo');
	t.is(developmentModeToAcpMode('plan'), 'plan');
});

// ============================================================================
// acpMcpServersToConfig
// ============================================================================

test('acpMcpServersToConfig - maps a stdio server, turning env pairs into a record', t => {
	const {servers, skipped} = acpMcpServersToConfig([
		{
			name: 'fs',
			command: '/usr/bin/mcp-fs',
			args: ['--root', '/work'],
			env: [
				{name: 'TOKEN', value: 'abc'},
				{name: 'MODE', value: 'ro'},
			],
		},
	]);

	t.deepEqual(servers, [
		{
			name: 'fs',
			transport: 'stdio',
			command: '/usr/bin/mcp-fs',
			args: ['--root', '/work'],
			env: {TOKEN: 'abc', MODE: 'ro'},
		},
	]);
	t.deepEqual(skipped, []);
});

test('acpMcpServersToConfig - maps an http server, turning header pairs into a record', t => {
	const {servers} = acpMcpServersToConfig([
		{
			type: 'http',
			name: 'browser',
			url: 'http://127.0.0.1:9000/mcp',
			headers: [{name: 'Authorization', value: 'Bearer x'}],
		},
	]);

	t.deepEqual(servers, [
		{
			name: 'browser',
			transport: 'http',
			url: 'http://127.0.0.1:9000/mcp',
			headers: {Authorization: 'Bearer x'},
		},
	]);
});

test('acpMcpServersToConfig - leaves out transports Nanocoder has none for, and says which', t => {
	const {servers, skipped} = acpMcpServersToConfig([
		{type: 'sse', name: 'events', url: 'http://x/sse', headers: []},
		{name: 'kept', command: 'node', args: [], env: []},
		{type: 'acp', name: 'inline', id: 'abc'} as never,
	]);

	t.deepEqual(
		servers.map(server => server.name),
		['kept'],
	);
	t.deepEqual(skipped, ['events (sse)', 'inline (acp)']);
});

test('acpMcpServersToConfig - an empty or missing list maps to nothing', t => {
	t.deepEqual(acpMcpServersToConfig([]), {servers: [], skipped: []});
	t.deepEqual(acpMcpServersToConfig(undefined), {servers: [], skipped: []});
});
