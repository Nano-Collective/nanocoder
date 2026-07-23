import test from 'ava';
import {
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
		providers: {},
		sessionCapabilities: {
			close: {},
			delete: {},
			list: {},
			resume: {},
		},
	});
});

// ============================================================================
// getAvailableModes
// ============================================================================

test('getAvailableModes - returns all four modes in order', t => {
	const modes = getAvailableModes();
	t.deepEqual(modes, ['normal', 'auto-accept', 'yolo', 'plan']);
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

test('acpModeToDevelopmentMode - falls back to auto-accept for unknown mode', t => {
	t.is(acpModeToDevelopmentMode('unknown' as any), 'auto-accept');
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
