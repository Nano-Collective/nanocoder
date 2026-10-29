import test from 'ava';
import {
	acpModeToDevelopmentMode,
	developmentModeToAcpMode,
	getAgentCapabilities,
	getAvailableModes,
	isVsCodeClient,
} from '@/acp/acp-capabilities';

console.log('\nacp-capabilities.spec.ts');

// ============================================================================
// getAgentCapabilities
// ============================================================================

test('getAgentCapabilities - returns session capabilities with close', t => {
	const caps = getAgentCapabilities();
	t.deepEqual(caps, {
		loadSession: true,
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
				],
				extNotifications: ['_nanocoder/sessionTitleChanged'],
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
// isVsCodeClient
// ============================================================================

test('isVsCodeClient - only the VS Code extension is recognised', t => {
	t.true(isVsCodeClient({name: 'Nanocoder VS Code Extension'}));
	t.false(isVsCodeClient({name: 'zed'}));
	t.false(isVsCodeClient({name: 'Nanocoder Desktop'}));
	t.false(isVsCodeClient(undefined));
	t.false(isVsCodeClient(null));
});
