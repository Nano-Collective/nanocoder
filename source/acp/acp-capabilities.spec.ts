import test from 'ava';
import {
	acpModeToDevelopmentMode,
	developmentModeToAcpMode,
	getAgentCapabilities,
	getAvailableModes,
	mergeDisabledTools,
	parseDisabledTools,
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
					'_nanocoder/timeline/read',
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
// Disabled tools
// ============================================================================

test('parseDisabledTools - reads the list a client sent under _meta', t => {
	t.deepEqual(
		parseDisabledTools({'nanocoder/disabledTools': ['browser', 'web_search']}),
		['browser', 'web_search'],
	);
});

test('parseDisabledTools - ignores anything that is not a list of names', t => {
	t.deepEqual(parseDisabledTools(undefined), []);
	t.deepEqual(parseDisabledTools(null), []);
	t.deepEqual(parseDisabledTools({}), []);
	t.deepEqual(parseDisabledTools({'nanocoder/disabledTools': 'browser'}), []);
	t.deepEqual(
		parseDisabledTools({'nanocoder/disabledTools': ['browser', 3, null, {}]}),
		['browser'],
	);
});

test('mergeDisabledTools - the session adds to the user\'s list and never replaces it', t => {
	t.deepEqual(
		mergeDisabledTools(['web_search'], ['browser']),
		['web_search', 'browser'],
	);
	// A tool in both lists is listed once.
	t.deepEqual(mergeDisabledTools(['browser'], ['browser', 'fetch_url']), [
		'browser',
		'fetch_url',
	]);
	t.deepEqual(mergeDisabledTools(undefined, ['browser']), ['browser']);
	t.deepEqual(mergeDisabledTools(['web_search']), ['web_search']);
	t.deepEqual(mergeDisabledTools(), []);
});
