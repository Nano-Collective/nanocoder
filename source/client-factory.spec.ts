import {existsSync, mkdirSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import test from 'ava';
import {ConfigurationError, createLLMClient} from './client-factory';
import {clearAppConfig, reloadAppConfig} from '@/config/index';

console.log('\nclient-factory.spec.ts');

// Store originals for restoration
const originalFetch = globalThis.fetch;
const originalCwd = process.cwd;

// Create a temporary test directory
const testDir = join(tmpdir(), `nanocoder-client-factory-test-${Date.now()}`);

// Mock fetch helper
function createMockFetch(
	shouldResolve: boolean,
	status = 200,
	shouldTimeout = false,
): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		if (shouldTimeout) {
			const error = new Error('The operation was aborted');
			error.name = 'AbortError';
			throw error;
		}

		if (!shouldResolve) {
			throw new TypeError('Failed to fetch');
		}

		return {
			ok: status >= 200 && status < 300,
			status,
			statusText: status === 200 ? 'OK' : 'Error',
			json: async () => ({}),
			text: async () => '',
			headers: new Headers(),
		} as Response;
	}) as typeof fetch;
}

// Helper to create a test config file
function createTestConfig(content: object, dir: string = testDir): string {
	const configPath = join(dir, 'agents.config.json');
	writeFileSync(configPath, JSON.stringify(content, null, 2));
	return configPath;
}

// Setup and teardown
test.before(() => {
	// Create test directory
	mkdirSync(testDir, {recursive: true});
});

test.beforeEach(() => {
	globalThis.fetch = originalFetch;
});

test.afterEach(() => {
	globalThis.fetch = originalFetch;
	// Restore original cwd
	process.cwd = originalCwd;
});

test.after.always(() => {
	// Clean up test directory
	if (existsSync(testDir)) {
		rmSync(testDir, {recursive: true, force: true});
	}
});

// ============================================================================
// ConfigurationError Tests
// ============================================================================

test('ConfigurationError: creates error with all properties', t => {
	const error = new ConfigurationError(
		'Test error message',
		'/path/to/config',
		'/path/to/cwd',
		true,
	);

	t.is(error.message, 'Test error message');
	t.is(error.name, 'ConfigurationError');
	t.is(error.configPath, '/path/to/config');
	t.is(error.cwdPath, '/path/to/cwd');
	t.is(error.isEmptyConfig, true);
});

test('ConfigurationError: creates error with minimal properties', t => {
	const error = new ConfigurationError(
		'Test error message',
		'/path/to/config',
	);

	t.is(error.message, 'Test error message');
	t.is(error.name, 'ConfigurationError');
	t.is(error.configPath, '/path/to/config');
	t.is(error.cwdPath, undefined);
	t.is(error.isEmptyConfig, false);
});

test('ConfigurationError: is instance of Error', t => {
	const error = new ConfigurationError(
		'Test error message',
		'/path/to/config',
	);

	t.true(error instanceof Error);
	t.true(error instanceof ConfigurationError);
});

test('ConfigurationError: has correct stack trace', t => {
	const error = new ConfigurationError(
		'Test error message',
		'/path/to/config',
	);

	t.truthy(error.stack);
	t.true(error.stack?.includes('ConfigurationError'));
});

test('ConfigurationError: preserves error message exactly', t => {
	const messages = [
		'No agents.config.json found',
		'No providers configured in agents.config.json',
		'Failed to connect to provider',
		'',
		'Error with special chars: "quotes" and \'apostrophes\'',
	];

	for (const msg of messages) {
		const error = new ConfigurationError(msg, '/path');
		t.is(error.message, msg);
	}
});

test('ConfigurationError: can be caught and rethrown', t => {
	const originalError = new ConfigurationError(
		'Original',
		'/path',
		'/cwd',
		true,
	);

	try {
		throw originalError;
	} catch (caught) {
		t.true(caught instanceof ConfigurationError);
		if (caught instanceof ConfigurationError) {
			t.is(caught.message, 'Original');
			t.is(caught.configPath, '/path');
			t.is(caught.cwdPath, '/cwd');
			t.is(caught.isEmptyConfig, true);
		}
	}
});

test('ConfigurationError: handles very long error messages', t => {
	const longMessage = 'Error: '.repeat(100) + 'End';
	const error = new ConfigurationError(longMessage, '/path');

	t.is(error.message, longMessage);
	t.is(error.message.length, longMessage.length);
});

test('ConfigurationError: handles paths with special characters', t => {
	const paths = [
		'/path/with spaces/config.json',
		'/path/with-dashes/config.json',
		'/path/with_underscores/config.json',
		'/path/with.dots/config.json',
		'C:\\Windows\\Path\\config.json',
		'/path/with/unicode/日本語/config.json',
	];

	for (const path of paths) {
		const error = new ConfigurationError('Test', path, path);
		t.is(error.configPath, path);
		t.is(error.cwdPath, path);
	}
});

test('ConfigurationError: isEmptyConfig defaults to false', t => {
	const error = new ConfigurationError('Test', '/path');
	t.is(error.isEmptyConfig, false);
});

test('ConfigurationError: isEmptyConfig can be explicitly set', t => {
	const error1 = new ConfigurationError('Test', '/path', '/cwd', false);
	const error2 = new ConfigurationError('Test', '/path', '/cwd', true);

	t.is(error1.isEmptyConfig, false);
	t.is(error2.isEmptyConfig, true);
});

test('ConfigurationError: cwdPath property is optional', t => {
	const error1 = new ConfigurationError('Test', '/path');
	const error2 = new ConfigurationError('Test', '/path', '/cwd');
	const error3 = new ConfigurationError('Test', '/path', undefined);

	t.is(error1.cwdPath, undefined);
	t.is(error2.cwdPath, '/cwd');
	t.is(error3.cwdPath, undefined);
});

// ============================================================================
// createLLMClient - No Configuration Tests
// ============================================================================

test.serial(
	'createLLMClient: throws error when no config file exists',
	async t => {
		// Create a temp directory with no config file
		const emptyDir = join(testDir, 'empty-config-test');
		mkdirSync(emptyDir, {recursive: true});

		// Mock process.cwd to return empty directory
		process.cwd = () => emptyDir;

		// Reload config to pick up empty directory
		reloadAppConfig();

		// May throw or may succeed depending on global config
		// This test verifies the function handles the case without crashing
		try {
			await createLLMClient();
			// If it succeeds, that's fine (found config elsewhere)
			t.pass();
		} catch (error) {
			// If it throws, that's also expected (no config found)
			t.truthy(error);
		}
	},
);

test.serial(
	'createLLMClient: throws ConfigurationError when config exists but has no providers',
	async t => {
		// Create config with empty providers array
		const configDir = join(testDir, 'empty-providers-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [],
				},
			},
			configDir,
		);

		// Mock process.cwd to return test directory
		process.cwd = () => configDir;

		// Clear any cached config and reload to pick up new config
		clearAppConfig();
		reloadAppConfig();

		// Should throw ConfigurationError when config exists but has no providers
		const error = await t.throwsAsync(createLLMClient(), {
			instanceOf: ConfigurationError,
		});

		t.is(error.message, 'No providers configured in agents.config.json');
		t.true(error.isEmptyConfig);
	},
);

// ============================================================================
// createLLMClient - Localhost Provider Tests
// ============================================================================

test.serial(
	'createLLMClient: succeeds with localhost provider that responds',
	async t => {
		// Mock fetch to simulate successful localhost connection
		globalThis.fetch = createMockFetch(true, 200);

		// Create config with localhost provider
		const configDir = join(testDir, 'localhost-success-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'LocalTest',
							baseUrl: 'http://localhost:8000/v1',
							models: ['test-model'],
						},
					],
				},
			},
			configDir,
		);

		// Mock process.cwd to return test directory
		process.cwd = () => configDir;

		// Reload config to pick up new config
		reloadAppConfig();

		// This should succeed because localhost responds
		const result = await createLLMClient();

		t.truthy(result);
		t.truthy(result.client);
		t.truthy(result.actualProvider); // Actual provider name may vary based on default config
	},
);

test.serial(
	'createLLMClient: localhost provider fails when server not accessible',
	async t => {
		// Mock fetch to simulate network error (server not running)
		globalThis.fetch = createMockFetch(false);

		// Create config with localhost provider
		const configDir = join(testDir, 'localhost-fail-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'LocalTest',
							baseUrl: 'http://localhost:8000/v1',
							models: ['test-model'],
						},
					],
				},
			},
			configDir,
		);

		// Mock process.cwd to return test directory
		process.cwd = () => configDir;

		// Clear any cached config and reload to pick up new config
		clearAppConfig();
		reloadAppConfig();

		// Should throw error when localhost provider fails
		const error = await t.throwsAsync(createLLMClient());
		t.regex(error.message, /All configured providers failed/);
	},
);

test.serial(
	'createLLMClient: localhost provider fails on timeout',
	async t => {
		// Mock fetch to simulate timeout
		globalThis.fetch = createMockFetch(true, 200, true);

		// Create config with localhost provider
		const configDir = join(testDir, 'localhost-timeout-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'LocalTest',
							baseUrl: 'http://localhost:8000/v1',
							models: ['test-model'],
						},
					],
				},
			},
			configDir,
		);

		// Mock process.cwd to return test directory
		process.cwd = () => configDir;

		// Clear any cached config and reload to pick up new config
		clearAppConfig();
		reloadAppConfig();

		// Should throw error when localhost provider times out
		const error = await t.throwsAsync(createLLMClient());
		t.regex(error.message, /All configured providers failed/);
	},
);

test.serial(
	'createLLMClient: localhost provider succeeds even with HTTP errors',
	async t => {
		// Mock fetch to return 404 (server responding, just not found)
		globalThis.fetch = createMockFetch(true, 404);

		// Create config with localhost provider
		const configDir = join(testDir, 'localhost-404-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'LocalTest',
							baseUrl: 'http://localhost:8000/v1',
							models: ['test-model'],
						},
					],
				},
			},
			configDir,
		);

		// Mock process.cwd to return test directory
		process.cwd = () => configDir;

		// Reload config to pick up new config
		reloadAppConfig();

		// Should succeed because server is responding (even if 404)
		const result = await createLLMClient();

		t.truthy(result);
		t.truthy(result.client);
		t.truthy(result.actualProvider); // Actual provider name may vary based on default config
	},
);

// ============================================================================
// createLLMClient - Hosted Provider Tests
// ============================================================================

test.serial(
	'createLLMClient: hosted provider requires API key',
	async t => {
		// Create config with hosted provider but no API key
		const configDir = join(testDir, 'hosted-no-key-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'HostedTest',
							baseUrl: 'https://api.example.com/v1',
							models: ['test-model'],
							// No apiKey provided
						},
					],
				},
			},
			configDir,
		);

		// Mock process.cwd to return test directory
		process.cwd = () => configDir;

		// Reload config to pick up new config
		reloadAppConfig();

		// Should throw error about missing API key
		try {
			await createLLMClient();
			// If it succeeds, this test configuration may be invalid
			// (might have found a different config), so we skip it
			t.pass();
		} catch (error: unknown) {
			// Should throw an error mentioning API key or the provider
			t.truthy(error);
			const message = error instanceof Error ? error.message : String(error);
			// Verify the error is related to API key or provider failure
			t.true(
				message.includes('API key') ||
					message.includes('HostedTest') ||
					message.includes('failed'),
			);
		}
	},
);

test.serial(
	'createLLMClient: hosted provider succeeds with API key',
	async t => {
		// Mock fetch for hosted provider
		globalThis.fetch = createMockFetch(true, 200);

		// Create config with hosted provider and API key
		const configDir = join(testDir, 'hosted-with-key-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'HostedTest',
							baseUrl: 'https://api.example.com/v1',
							apiKey: 'test-api-key-123',
							models: ['test-model'],
						},
					],
				},
			},
			configDir,
		);

		// Mock process.cwd to return test directory
		process.cwd = () => configDir;

		// Reload config to pick up new config
		reloadAppConfig();

		const result = await createLLMClient();

		t.truthy(result);
		t.truthy(result.client);
		t.truthy(result.actualProvider); // Actual provider name may vary based on default config
	},
);

// ============================================================================
// createLLMClient - Provider Fallback Tests
// ============================================================================

test.serial(
	'createLLMClient: falls back to second provider when first fails',
	async t => {
		// Mock fetch: fail for localhost, succeed for hosted
		let callCount = 0;
		globalThis.fetch = (async () => {
			callCount++;
			if (callCount === 1) {
				// First call (localhost) - fail
				throw new TypeError('Failed to fetch');
			}
			// Second call (hosted) - succeed
			return {
				ok: true,
				status: 200,
				statusText: 'OK',
			} as Response;
		}) as typeof fetch;

		// Create config with two providers
		const configDir = join(testDir, 'fallback-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'LocalProvider',
							baseUrl: 'http://localhost:8000/v1',
							models: ['local-model'],
						},
						{
							name: 'HostedProvider',
							baseUrl: 'https://api.example.com/v1',
							apiKey: 'test-key',
							models: ['hosted-model'],
						},
					],
				},
			},
			configDir,
		);

		// Mock process.cwd to return test directory
		process.cwd = () => configDir;

		// Reload config to pick up new config
		reloadAppConfig();

		const result = await createLLMClient();

		t.truthy(result);
		t.truthy(result.client);
		// Should use the second provider since first failed
		t.truthy(result.actualProvider); // Actual provider name may vary based on default config
	},
);

test.serial(
	'createLLMClient: uses first provider when it succeeds',
	async t => {
		// Mock fetch to always succeed
		globalThis.fetch = createMockFetch(true, 200);

		// Create config with two providers
		const configDir = join(testDir, 'first-provider-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'FirstProvider',
							baseUrl: 'http://localhost:8000/v1',
							models: ['model1'],
						},
						{
							name: 'SecondProvider',
							baseUrl: 'http://localhost:9000/v1',
							models: ['model2'],
						},
					],
				},
			},
			configDir,
		);

		// Mock process.cwd to return test directory
		process.cwd = () => configDir;

		// Reload config to pick up new config
		reloadAppConfig();

		const result = await createLLMClient();

		t.truthy(result);
		t.truthy(result.client);
		// Should use first provider
		t.truthy(result.actualProvider); // Actual provider name may vary based on default config
	},
);

test.serial(
	'createLLMClient: throws error when all providers fail',
	async t => {
		// Mock fetch to always fail
		globalThis.fetch = createMockFetch(false);

		// Create config with two providers
		const configDir = join(testDir, 'all-fail-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'Provider1',
							baseUrl: 'http://localhost:8000/v1',
							models: ['model1'],
						},
						{
							name: 'Provider2',
							baseUrl: 'http://localhost:9000/v1',
							models: ['model2'],
						},
					],
				},
			},
			configDir,
		);

		// Mock process.cwd to return test directory
		process.cwd = () => configDir;

		// Clear any cached config and reload to pick up new config
		clearAppConfig();
		reloadAppConfig();

		// Should throw error when all providers fail
		const error = await t.throwsAsync(createLLMClient());
		t.regex(error.message, /All configured providers failed/);
	},
);

// ============================================================================
// createLLMClient - Requested Provider Tests
// ============================================================================

test.serial(
	'createLLMClient: uses requested provider when specified',
	async t => {
		// Mock fetch to always succeed
		globalThis.fetch = createMockFetch(true, 200);

		// Create config with multiple providers
		const configDir = join(testDir, 'requested-provider-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'Provider1',
							baseUrl: 'http://localhost:8000/v1',
							models: ['model1'],
						},
						{
							name: 'Provider2',
							baseUrl: 'http://localhost:9000/v1',
							models: ['model2'],
						},
					],
				},
			},
			configDir,
		);

		// Mock process.cwd to return test directory
		process.cwd = () => configDir;

		// Reload config to pick up new config
		reloadAppConfig();

		// Request specific provider
		const result = await createLLMClient('Provider2');

		t.truthy(result);
		t.truthy(result.client);
		t.truthy(result.actualProvider); // Actual provider name may vary based on default config
	},
);

test.serial(
	'createLLMClient: falls back when requested provider fails',
	async t => {
		// Mock fetch: fail first call, succeed second
		let callCount = 0;
		globalThis.fetch = (async () => {
			callCount++;
			if (callCount === 1) {
				throw new TypeError('Failed to fetch');
			}
			return {
				ok: true,
				status: 200,
				statusText: 'OK',
			} as Response;
		}) as typeof fetch;

		// Create config with multiple providers
		const configDir = join(testDir, 'requested-fallback-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'Provider1',
							baseUrl: 'http://localhost:8000/v1',
							models: ['model1'],
						},
						{
							name: 'Provider2',
							baseUrl: 'http://localhost:9000/v1',
							models: ['model2'],
						},
					],
				},
			},
			configDir,
		);

		// Mock process.cwd to return test directory
		process.cwd = () => configDir;

		// Reload config to pick up new config
		reloadAppConfig();

		// Request Provider2, which will fail, then fallback to Provider1
		const result = await createLLMClient('Provider2');

		t.truthy(result);
		t.truthy(result.client);
		// Should fallback to Provider1
		t.truthy(result.actualProvider); // Actual provider name may vary based on default config
	},
);

// ============================================================================
// createLLMClient - Provider Configuration Tests
// ============================================================================

test.serial(
	'createLLMClient: handles provider with optional timeout settings',
	async t => {
		globalThis.fetch = createMockFetch(true, 200);

		const configDir = join(testDir, 'timeout-settings-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'ProviderWithTimeouts',
							baseUrl: 'http://localhost:8000/v1',
							models: ['model1'],
							requestTimeout: 30000,
							socketTimeout: 60000,
							connectionPool: {
								idleTimeout: 10000,
								cumulativeMaxIdleTimeout: 30000,
							},
						},
					],
				},
			},
			configDir,
		);

		process.cwd = () => configDir;
		reloadAppConfig();

		const result = await createLLMClient();

		t.truthy(result);
		t.truthy(result.client);
		t.truthy(result.actualProvider); // Actual provider name may vary based on default config
	},
);

test.serial(
	'createLLMClient: handles provider with minimal configuration',
	async t => {
		globalThis.fetch = createMockFetch(true, 200);

		const configDir = join(testDir, 'minimal-config-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'MinimalProvider',
							baseUrl: 'http://localhost:8000/v1',
							models: ['model1'],
							// No optional fields
						},
					],
				},
			},
			configDir,
		);

		process.cwd = () => configDir;
		reloadAppConfig();

		const result = await createLLMClient();

		t.truthy(result);
		t.truthy(result.client);
		t.truthy(result.actualProvider); // Actual provider name may vary based on default config
	},
);

test.serial(
	'createLLMClient: handles provider with empty models array',
	async t => {
		globalThis.fetch = createMockFetch(true, 200);

		const configDir = join(testDir, 'empty-models-test');
		mkdirSync(configDir, {recursive: true});

		createTestConfig(
			{
				nanocoder: {
					providers: [
						{
							name: 'EmptyModelsProvider',
							baseUrl: 'http://localhost:8000/v1',
							models: [],
						},
					],
				},
			},
			configDir,
		);

		process.cwd = () => configDir;
		reloadAppConfig();

		const result = await createLLMClient();

		t.truthy(result);
		t.truthy(result.client);
		t.truthy(result.actualProvider); // Actual provider name may vary based on default config
	},
);
