import test from 'ava';
import {AISDKClient} from '@/ai-sdk-client';
import type {AIProviderConfig} from '@/types/config';

// Tests for maxRetries configuration
// Now tests actual AISDKClient instantiation and behavior

test('AISDKClient - maxRetries defaults to 2 when not specified', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai-compatible',
		models: ['test-model'],
		config: {
			baseURL: 'http://localhost:11434/v1',
			apiKey: 'test-key',
		},
	};

	const client = new AISDKClient(config);

	// Verify the client's internal maxRetries is set to default of 2
	t.is(client.getMaxRetries(), 2);
});

test('AISDKClient - maxRetries respects custom value', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai-compatible',
		models: ['test-model'],
		maxRetries: 5,
		config: {
			baseURL: 'http://localhost:11434/v1',
			apiKey: 'test-key',
		},
	};

	const client = new AISDKClient(config);

	// Verify the client uses the custom maxRetries value
	t.is(client.getMaxRetries(), 5);
});

test('AISDKClient - maxRetries can be set to 0 to disable retries', t => {
	// Important: This test verifies that 0 is treated as a valid value,
	// not as falsy (which would incorrectly default to 2)
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai-compatible',
		models: ['test-model'],
		maxRetries: 0,
		config: {
			baseURL: 'http://localhost:11434/v1',
			apiKey: 'test-key',
		},
	};

	const client = new AISDKClient(config);

	// Verify that 0 is respected (nullish coalescing handles this correctly)
	t.is(client.getMaxRetries(), 0);
});

test('AISDKClient - maxRetries handles value of 1', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai-compatible',
		models: ['test-model'],
		maxRetries: 1,
		config: {
			baseURL: 'http://localhost:11434/v1',
			apiKey: 'test-key',
		},
	};

	const client = new AISDKClient(config);

	t.is(client.getMaxRetries(), 1);
});

test('AIProviderConfig type - includes maxRetries in interface', t => {
	// Compile-time test that maxRetries is part of the interface
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai-compatible',
		models: ['test-model'],
		maxRetries: 3,
		config: {
			baseURL: 'http://localhost:11434/v1',
		},
	};

	// TypeScript should not complain about maxRetries property
	t.is(typeof config.maxRetries, 'number');
	t.true('maxRetries' in config);
});

test('AISDKClient - undefined maxRetries uses default', t => {
	// Explicitly set to undefined to test fallback behavior
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai-compatible',
		models: ['test-model'],
		maxRetries: undefined,
		config: {
			baseURL: 'http://localhost:11434/v1',
			apiKey: 'test-key',
		},
	};

	const client = new AISDKClient(config);

	// Verify undefined falls back to default of 2
	t.is(client.getMaxRetries(), 2);
});
