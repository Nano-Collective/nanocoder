import {EventEmitter} from 'node:events';
import test from 'ava';
import {
	LSPManager,
	type LSPManagerConfig,
	getLSPManager,
	resetLSPManager,
} from './lsp-manager';

console.log(`\nlsp-manager.spec.ts`);

// Reset the singleton before each test to ensure isolation
test.beforeEach(async () => {
	await resetLSPManager();
});

// Clean up after all tests
test.afterEach(async () => {
	await resetLSPManager();
});

// Constructor tests
test('LSPManager - creates with default config', t => {
	const manager = new LSPManager();
	t.truthy(manager);
	t.true(manager instanceof EventEmitter);
});

test('LSPManager - creates with custom rootUri', t => {
	const manager = new LSPManager({
		rootUri: 'file:///custom/path',
	});
	t.truthy(manager);
});

test('LSPManager - creates with servers config', t => {
	const manager = new LSPManager({
		servers: [
			{
				name: 'test-server',
				command: 'test',
				languages: ['ts'],
			},
		],
	});
	t.truthy(manager);
});

// isInitialized tests
test('LSPManager - isInitialized returns false before initialization', t => {
	const manager = new LSPManager();
	t.false(manager.isInitialized());
});

// getConnectedServers tests
test('LSPManager - getConnectedServers returns empty array initially', t => {
	const manager = new LSPManager();
	t.deepEqual(manager.getConnectedServers(), []);
});

// getSupportedLanguages tests
test('LSPManager - getSupportedLanguages returns empty array initially', t => {
	const manager = new LSPManager();
	t.deepEqual(manager.getSupportedLanguages(), []);
});

// hasLanguageSupport tests
test('LSPManager - hasLanguageSupport returns false when no servers', t => {
	const manager = new LSPManager();
	t.false(manager.hasLanguageSupport('test.ts'));
	t.false(manager.hasLanguageSupport('test.py'));
	t.false(manager.hasLanguageSupport('test.go'));
});

// getStatus tests
test('LSPManager - getStatus returns correct initial state', t => {
	const manager = new LSPManager();
	const status = manager.getStatus();

	t.false(status.initialized);
	t.deepEqual(status.servers, []);
});

// getAllDiagnostics tests
test('LSPManager - getAllDiagnostics returns empty array initially', t => {
	const manager = new LSPManager();
	t.deepEqual(manager.getAllDiagnostics(), []);
});

// getDiagnostics tests
test('LSPManager - getDiagnostics returns empty array for unknown file', async t => {
	const manager = new LSPManager();
	const result = await manager.getDiagnostics('/test/file.ts');
	t.deepEqual(result, []);
});

// getCompletions tests
test('LSPManager - getCompletions returns empty array when no client', async t => {
	const manager = new LSPManager();
	const result = await manager.getCompletions('/test/file.ts', 0, 0);
	t.deepEqual(result, []);
});

// getCodeActions tests
test('LSPManager - getCodeActions returns empty array when no client', async t => {
	const manager = new LSPManager();
	const result = await manager.getCodeActions('/test/file.ts', 0, 0, 1, 10);
	t.deepEqual(result, []);
});

test('LSPManager - getCodeActions accepts optional diagnostics', async t => {
	const manager = new LSPManager();
	const diagnostics = [
		{
			range: {
				start: {line: 0, character: 0},
				end: {line: 0, character: 5},
			},
			message: 'Test error',
		},
	];
	const result = await manager.getCodeActions(
		'/test/file.ts',
		0,
		0,
		1,
		10,
		diagnostics,
	);
	t.deepEqual(result, []);
});

// formatDocument tests
test('LSPManager - formatDocument returns empty array when no client', async t => {
	const manager = new LSPManager();
	const result = await manager.formatDocument('/test/file.ts');
	t.deepEqual(result, []);
});

test('LSPManager - formatDocument accepts options', async t => {
	const manager = new LSPManager();
	const result = await manager.formatDocument('/test/file.ts', {
		tabSize: 4,
		insertSpaces: false,
	});
	t.deepEqual(result, []);
});

// openDocument tests
test('LSPManager - openDocument returns false when no client available', async t => {
	const manager = new LSPManager();
	const result = await manager.openDocument('/test/file.ts');
	t.false(result);
});

test('LSPManager - openDocument returns false for unsupported extension', async t => {
	const manager = new LSPManager();
	const result = await manager.openDocument('/test/file.xyz');
	t.false(result);
});

// updateDocument tests
test('LSPManager - updateDocument returns false when no client available', t => {
	const manager = new LSPManager();
	const result = manager.updateDocument('/test/file.ts', 'new content');
	t.false(result);
});

// closeDocument tests
test('LSPManager - closeDocument returns false when no client available', t => {
	const manager = new LSPManager();
	const result = manager.closeDocument('/test/file.ts');
	t.false(result);
});

// shutdown tests
test('LSPManager - shutdown does not throw when not initialized', async t => {
	const manager = new LSPManager();
	await t.notThrowsAsync(async () => {
		await manager.shutdown();
	});
});

test('LSPManager - shutdown clears state', async t => {
	const manager = new LSPManager();
	await manager.shutdown();

	t.false(manager.isInitialized());
	t.deepEqual(manager.getConnectedServers(), []);
	t.deepEqual(manager.getSupportedLanguages(), []);
});

// Event emitter tests
test('LSPManager - is an EventEmitter', t => {
	const manager = new LSPManager();
	t.true(manager instanceof EventEmitter);
});

test('LSPManager - can add diagnostics listeners', t => {
	const manager = new LSPManager();
	let called = false;

	manager.on('diagnostics', () => {
		called = true;
	});

	manager.emit('diagnostics', {uri: 'test', diagnostics: []});
	t.true(called);
});

test('LSPManager - can remove listeners', t => {
	const manager = new LSPManager();
	let count = 0;

	const listener = () => count++;
	manager.on('diagnostics', listener);
	manager.emit('diagnostics', {uri: 'test', diagnostics: []});
	t.is(count, 1);

	manager.off('diagnostics', listener);
	manager.emit('diagnostics', {uri: 'test', diagnostics: []});
	t.is(count, 1);
});

// Singleton tests
test('getLSPManager - returns an LSPManager instance', async t => {
	const manager = await getLSPManager();
	t.truthy(manager);
	t.true(manager instanceof LSPManager);
});

test('getLSPManager - returns same instance on multiple calls', async t => {
	const manager1 = await getLSPManager();
	const manager2 = await getLSPManager();
	t.is(manager1, manager2);
});

test('getLSPManager - accepts config on first call', async t => {
	const manager = await getLSPManager({rootUri: 'file:///test'});
	t.truthy(manager);
});

test('getLSPManager - prevents race conditions with concurrent calls', async t => {
	await resetLSPManager();
	// Call getLSPManager multiple times concurrently
	const [manager1, manager2, manager3] = await Promise.all([
		getLSPManager(),
		getLSPManager(),
		getLSPManager(),
	]);
	// All should return the same instance
	t.is(manager1, manager2);
	t.is(manager2, manager3);
});

// resetLSPManager tests
test('resetLSPManager - creates fresh instance after reset', async t => {
	const manager1 = await getLSPManager();
	await resetLSPManager();
	const manager2 = await getLSPManager();

	t.not(manager1, manager2);
});

test('resetLSPManager - does not throw when no instance exists', async t => {
	await resetLSPManager();
	await t.notThrowsAsync(async () => {
		await resetLSPManager();
	});
});

// initialize tests
test('LSPManager - initialize returns array of results', async t => {
	const manager = new LSPManager();
	const results = await manager.initialize({
		autoDiscover: false,
		servers: [],
	});

	t.true(Array.isArray(results));
});

test('LSPManager - initialize sets initialized flag', async t => {
	const manager = new LSPManager();
	await manager.initialize({
		autoDiscover: false,
		servers: [],
	});

	t.true(manager.isInitialized());
});

test('LSPManager - initialize accepts onProgress callback', async t => {
	const manager = new LSPManager();
	const progressResults: unknown[] = [];

	await manager.initialize({
		autoDiscover: false,
		servers: [],
		onProgress: result => {
			progressResults.push(result);
		},
	});

	// With no servers, there should be no progress callbacks
	t.deepEqual(progressResults, []);
});

// Config validation
test('LSPManager - handles empty config', t => {
	const manager = new LSPManager({});
	t.truthy(manager);
});

test('LSPManager - handles config with all options', t => {
	const config: LSPManagerConfig = {
		rootUri: 'file:///workspace',
		servers: [
			{
				name: 'test',
				command: 'test',
				languages: ['ts'],
			},
		],
		autoDiscover: false,
		onProgress: () => {},
	};

	const manager = new LSPManager(config);
	t.truthy(manager);
});

// File path handling
test('LSPManager - handles absolute paths', async t => {
	const manager = new LSPManager();
	const result = await manager.openDocument('/absolute/path/file.ts');
	t.false(result); // No client, but shouldn't throw
});

test('LSPManager - handles file:// URIs', async t => {
	const manager = new LSPManager();
	const result = await manager.openDocument('file:///test/file.ts');
	t.false(result); // No client, but shouldn't throw
});

// Extension detection
test('LSPManager - hasLanguageSupport handles various extensions', t => {
	const manager = new LSPManager();

	// All should return false when no servers are connected
	t.false(manager.hasLanguageSupport('file.ts'));
	t.false(manager.hasLanguageSupport('file.tsx'));
	t.false(manager.hasLanguageSupport('file.js'));
	t.false(manager.hasLanguageSupport('file.py'));
	t.false(manager.hasLanguageSupport('file.rs'));
	t.false(manager.hasLanguageSupport('file.go'));
});

// Diagnostics result structure
test('LSPManager - getAllDiagnostics returns correct structure', t => {
	const manager = new LSPManager();
	const results = manager.getAllDiagnostics();

	t.true(Array.isArray(results));
	// Each result should have uri and diagnostics properties
	for (const result of results) {
		t.truthy(result.uri !== undefined);
		t.truthy(result.diagnostics !== undefined);
	}
});

// Status structure
test('LSPManager - getStatus returns correct structure', t => {
	const manager = new LSPManager();
	const status = manager.getStatus();

	t.true(typeof status.initialized === 'boolean');
	t.true(Array.isArray(status.servers));

	for (const server of status.servers) {
		t.truthy(server.name !== undefined);
		t.true(typeof server.ready === 'boolean');
		t.true(Array.isArray(server.languages));
	}
});

// Note: Tests for initialize with invalid server commands are not included as
// they cause uncaught exceptions from child_process.spawn that AVA cannot properly catch.
// Error handling for invalid servers is tested via manual integration testing.

// Content parameter in openDocument
test('LSPManager - openDocument accepts optional content', async t => {
	const manager = new LSPManager();
	const result = await manager.openDocument('/test/file.ts', 'const x = 1;');
	t.false(result); // No client, but should accept content parameter
});

// Multi-line range in getCodeActions
test('LSPManager - getCodeActions handles multi-line ranges', async t => {
	const manager = new LSPManager();
	const result = await manager.getCodeActions('/test/file.ts', 0, 0, 100, 50);
	t.deepEqual(result, []);
});

// Formatting options
test('LSPManager - formatDocument with full options', async t => {
	const manager = new LSPManager();
	const result = await manager.formatDocument('/test/file.ts', {
		tabSize: 4,
		insertSpaces: false,
		trimTrailingWhitespace: true,
		insertFinalNewline: true,
		trimFinalNewlines: true,
	});
	t.deepEqual(result, []);
});

// Edge cases
test('LSPManager - handles file with no extension', async t => {
	const manager = new LSPManager();
	const result = await manager.openDocument('/test/Makefile');
	t.false(result);
});

test('LSPManager - handles hidden files', async t => {
	const manager = new LSPManager();
	const result = await manager.openDocument('/test/.gitignore');
	t.false(result);
});

test('LSPManager - getDiagnostics handles paths with spaces', async t => {
	const manager = new LSPManager();
	const result = await manager.getDiagnostics('/test/my file.ts');
	t.deepEqual(result, []);
});

test('LSPManager - getDiagnostics handles paths with special chars', async t => {
	const manager = new LSPManager();
	const result = await manager.getDiagnostics('/test/[special]/file.ts');
	t.deepEqual(result, []);
});

// Unicode file paths
test('LSPManager - handles unicode file paths', async t => {
	const manager = new LSPManager();
	const result = await manager.openDocument('/test/файл.ts');
	t.false(result);
});

// Completion position
test('LSPManager - getCompletions with various positions', async t => {
	const manager = new LSPManager();

	// Start of file
	t.deepEqual(await manager.getCompletions('/test.ts', 0, 0), []);

	// Middle of file
	t.deepEqual(await manager.getCompletions('/test.ts', 50, 25), []);

	// Large line number
	t.deepEqual(await manager.getCompletions('/test.ts', 10000, 0), []);
});

// Shutdown and reinitialize
test('LSPManager - can shutdown and reinitialize', async t => {
	const manager = new LSPManager();

	await manager.initialize({autoDiscover: false, servers: []});
	t.true(manager.isInitialized());

	await manager.shutdown();
	t.false(manager.isInitialized());

	await manager.initialize({autoDiscover: false, servers: []});
	t.true(manager.isInitialized());
});

// Event handling after shutdown
test('LSPManager - events still work after shutdown', async t => {
	const manager = new LSPManager();
	await manager.shutdown();

	let called = false;
	manager.on('diagnostics', () => {
		called = true;
	});

	manager.emit('diagnostics', {uri: 'test', diagnostics: []});
	t.true(called);
});
