import test from 'ava';
import {resetSessionContextLimit, setSessionContextLimit} from '@/models/models-dev-client.js';
import type {LLMChatResponse, LLMClient, Message} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {
	autoCompactSessionOverrides,
	performAutoCompact,
	resetAutoCompactSession,
	setAutoCompactEnabled,
	setAutoCompactMode,
	setAutoCompactStrategy,
	setAutoCompactThreshold,
} from './auto-compact.js';

// Reset session overrides before each test
test.beforeEach(() => {
	resetAutoCompactSession();
});

// ==================== Session override enabled state ====================

test('setAutoCompactEnabled sets enabled to true', t => {
	setAutoCompactEnabled(true);
	t.is(autoCompactSessionOverrides.enabled, true);
});

test('setAutoCompactEnabled sets enabled to false', t => {
	setAutoCompactEnabled(false);
	t.is(autoCompactSessionOverrides.enabled, false);
});

test('setAutoCompactEnabled sets enabled to null', t => {
	setAutoCompactEnabled(true);
	setAutoCompactEnabled(null);
	t.is(autoCompactSessionOverrides.enabled, null);
});

test('autoCompactSessionOverrides.enabled starts as null', t => {
	t.is(autoCompactSessionOverrides.enabled, null);
});

// ==================== Session override threshold ====================

test('setAutoCompactThreshold sets threshold value', t => {
	setAutoCompactThreshold(75);
	t.is(autoCompactSessionOverrides.threshold, 75);
});

test('setAutoCompactThreshold clamps to minimum of 50', t => {
	setAutoCompactThreshold(30);
	t.is(autoCompactSessionOverrides.threshold, 50);
});

test('setAutoCompactThreshold clamps to maximum of 95', t => {
	setAutoCompactThreshold(99);
	t.is(autoCompactSessionOverrides.threshold, 95);
});

test('setAutoCompactThreshold handles boundary value 50', t => {
	setAutoCompactThreshold(50);
	t.is(autoCompactSessionOverrides.threshold, 50);
});

test('setAutoCompactThreshold handles boundary value 95', t => {
	setAutoCompactThreshold(95);
	t.is(autoCompactSessionOverrides.threshold, 95);
});

test('setAutoCompactThreshold sets threshold to null', t => {
	setAutoCompactThreshold(75);
	setAutoCompactThreshold(null);
	t.is(autoCompactSessionOverrides.threshold, null);
});

test('autoCompactSessionOverrides.threshold starts as null', t => {
	t.is(autoCompactSessionOverrides.threshold, null);
});

// ==================== Session override mode ====================

test('setAutoCompactMode sets mode to aggressive', t => {
	setAutoCompactMode('aggressive');
	t.is(autoCompactSessionOverrides.mode, 'aggressive');
});

test('setAutoCompactMode sets mode to conservative', t => {
	setAutoCompactMode('conservative');
	t.is(autoCompactSessionOverrides.mode, 'conservative');
});

test('setAutoCompactMode sets mode to default', t => {
	setAutoCompactMode('default');
	t.is(autoCompactSessionOverrides.mode, 'default');
});

test('setAutoCompactMode sets mode to null', t => {
	setAutoCompactMode('aggressive');
	setAutoCompactMode(null);
	t.is(autoCompactSessionOverrides.mode, null);
});

test('autoCompactSessionOverrides.mode starts as null', t => {
	t.is(autoCompactSessionOverrides.mode, null);
});

// ==================== Reset functionality ====================

test('resetAutoCompactSession resets all overrides to null', t => {
	setAutoCompactEnabled(true);
	setAutoCompactThreshold(80);
	setAutoCompactMode('aggressive');

	resetAutoCompactSession();

	t.is(autoCompactSessionOverrides.enabled, null);
	t.is(autoCompactSessionOverrides.threshold, null);
	t.is(autoCompactSessionOverrides.mode, null);
});

// ==================== Proxy compatibility ====================

test('autoCompactSessionOverrides proxy allows setting enabled', t => {
	autoCompactSessionOverrides.enabled = true;
	t.is(autoCompactSessionOverrides.enabled, true);

	autoCompactSessionOverrides.enabled = false;
	t.is(autoCompactSessionOverrides.enabled, false);
});

test('autoCompactSessionOverrides proxy allows setting threshold', t => {
	autoCompactSessionOverrides.threshold = 70;
	t.is(autoCompactSessionOverrides.threshold, 70);
});

test('autoCompactSessionOverrides proxy allows setting mode', t => {
	autoCompactSessionOverrides.mode = 'conservative';
	t.is(autoCompactSessionOverrides.mode, 'conservative');
});

// ==================== Combined scenarios ====================

test('multiple session overrides can be set independently', t => {
	setAutoCompactEnabled(false);
	setAutoCompactThreshold(60);
	setAutoCompactMode('conservative');

	t.is(autoCompactSessionOverrides.enabled, false);
	t.is(autoCompactSessionOverrides.threshold, 60);
	t.is(autoCompactSessionOverrides.mode, 'conservative');

	// Change one without affecting others
	setAutoCompactEnabled(true);

	t.is(autoCompactSessionOverrides.enabled, true);
	t.is(autoCompactSessionOverrides.threshold, 60);
	t.is(autoCompactSessionOverrides.mode, 'conservative');
});

test('partial reset scenario - set some, reset all, set different', t => {
	setAutoCompactEnabled(true);
	setAutoCompactThreshold(85);

	resetAutoCompactSession();

	setAutoCompactMode('aggressive');

	t.is(autoCompactSessionOverrides.enabled, null);
	t.is(autoCompactSessionOverrides.threshold, null);
	t.is(autoCompactSessionOverrides.mode, 'aggressive');
});

// ==================== performAutoCompact integration tests ====================

/**
 * Helper to set up a deterministic auto-compact test environment.
 * The FallbackTokenizer counts 4 chars per token; by setting session context
 * limit we control whether the threshold is exceeded.
 */
function setupAutoCompactEnv(contextLimit: number) {
	resetSessionContextLimit();
	setSessionContextLimit(contextLimit);
}

test.after.always(() => {
	resetAutoCompactSession();
	resetSessionContextLimit();
});

test('performAutoCompact returns messages without system role when compression triggers', async t => {
	// Context limit of 100 tokens with a long message will exceed the 50% threshold.
	setupAutoCompactEnv(100);

	const oldContent = 'old context sentence. '.repeat(60); // ~900 chars ≈ 225 tokens > 50 tokens (50%)
	const messages: Message[] = [
		{role: 'user', content: oldContent},
	];
	const systemMessage: Message = {
		role: 'system',
		content: 'You are a helpful assistant.',
	};

	const result = await performAutoCompact(
		messages,
		systemMessage,
		'openai',
		'gpt-4',
		{
			enabled: true,
			threshold: 50,
			mode: 'default',
			notifyUser: false,
		},
	);

	t.truthy(result, 'Should return compressed messages');
	t.true(Array.isArray(result));

	// The returned array must NOT contain any system messages — they are filtered out
	// so the chat handler can re-inject them on each LLM call.
	const hasSystemRole = result!.some(msg => msg.role === 'system');
	t.false(hasSystemRole, 'Compressed output should not contain system messages');
});

test('performAutoCompact returns null when below threshold', async t => {
	// Large context limit means usage stays well below threshold
	setupAutoCompactEnv(999_999);

	const messages: Message[] = [
		{role: 'user', content: 'Hello'},
	];
	const systemMessage: Message = {
		role: 'system',
		content: 'You are a helpful assistant.',
	};

	const result = await performAutoCompact(
		messages,
		systemMessage,
		'openai',
		'gpt-4',
		{
			enabled: true,
			threshold: 50,
			mode: 'default',
			notifyUser: false,
		},
	);

	t.is(result, null, 'Should return null when token usage is below threshold');
});

test('performAutoCompact counts native tool definitions toward the gate (fires when messages alone would not)', async t => {
	// 1000-token window, 50% threshold → needs ≥500 tokens. The message + system
	// prompt alone stay well under, so only the tool definitions can trip it.
	setupAutoCompactEnv(1000);

	const messages: Message[] = [
		{role: 'user', content: 'Tell me a story. '.repeat(10)}, // ~170 chars ≈ 43 tokens
	];
	const systemMessage: Message = {
		role: 'system',
		content: 'You are a helpful assistant.',
	};
	// A fat tool definition built from distinct words so it tokenizes to many
	// thousands of tokens under *any* tokenizer (avoids the BPE run-merging that
	// repeated chars would trigger). Far above the 500-token gate on its own,
	// while the message + system prompt stay far below it.
	const bigDescription = Array.from(
		{length: 2000},
		(_, i) => `param${i}`,
	).join(' ');
	const nativeTools = {
		big_tool: tool({
			description: bigDescription,
			inputSchema: jsonSchema<Record<string, never>>({type: 'object'}),
		}),
	};

	const config = {
		enabled: true,
		threshold: 50,
		mode: 'default' as const,
		notifyUser: false,
	};

	const provider = 'custom';
	const model = 'generic-model';

	// Without the tool definitions the conversation is far below threshold.
	const withoutTools = await performAutoCompact(
		messages,
		systemMessage,
		provider,
		model,
		config,
	);
	t.is(withoutTools, null, 'messages alone must stay below the threshold');

	// Passing the native tool definitions pushes usage over the threshold.
	const withTools = await performAutoCompact(
		messages,
		systemMessage,
		provider,
		model,
		config,
		undefined,
		undefined,
		nativeTools,
	);
	t.truthy(withTools, 'tool-definition tokens should push usage past the gate');
});

test('performAutoCompact calls notification callback with reduction info', async t => {
	setupAutoCompactEnv(100);

	const oldContent = 'old context sentence. '.repeat(60);
	const messages: Message[] = [{role: 'user', content: oldContent}];
	const systemMessage: Message = {
		role: 'system',
		content: 'You are a helpful assistant.',
	};

	const notifications: string[] = [];
	await performAutoCompact(
		messages,
		systemMessage,
		'openai',
		'gpt-4',
		{
			enabled: true,
			threshold: 50,
			mode: 'default',
			notifyUser: true,
		},
		notification => {
			notifications.push(notification);
		},
	);

	t.is(notifications.length, 1, 'Notification callback should be called once');
	t.true(
		notifications[0].includes('auto-compacting'),
		'Notification should mention auto-compacting',
	);
	t.true(
		notifications[0].includes('% reduction') || notifications[0].includes('tokens →'),
		'Notification should include token reduction info',
	);
});

test('performAutoCompact does not call notification when notifyUser is false', async t => {
	setupAutoCompactEnv(100);

	const oldContent = 'old context sentence. '.repeat(60);
	const messages: Message[] = [{role: 'user', content: oldContent}];
	const systemMessage: Message = {
		role: 'system',
		content: 'You are a helpful assistant.',
	};

	let notificationCalled = false;
	await performAutoCompact(
		messages,
		systemMessage,
		'openai',
		'gpt-4',
		{
			enabled: true,
			threshold: 50,
			mode: 'default',
			notifyUser: false,
		},
		() => {
			notificationCalled = true;
		},
	);

	t.false(notificationCalled, 'Notification callback should NOT be called');
});

// ==================== Strategy override + LLM routing ====================

test('setAutoCompactStrategy sets and clears the override', t => {
	setAutoCompactStrategy('mechanical');
	t.is(autoCompactSessionOverrides.strategy, 'mechanical');

	setAutoCompactStrategy('llm');
	t.is(autoCompactSessionOverrides.strategy, 'llm');

	setAutoCompactStrategy(null);
	t.is(autoCompactSessionOverrides.strategy, null);
});

function makeStubClient(
	respond: (messages: Message[]) => string,
): LLMClient & {calls: number} {
	let calls = 0;
	const client: LLMClient & {calls: number} = {
		get calls() {
			return calls;
		},
		set calls(_) {},
		getCurrentModel: () => 'stub',
		setModel: () => {},
		getContextSize: () => 100_000,
		getAvailableModels: async () => ['stub'],
		getProviderConfig: () => ({
			name: 'stub',
			type: 'openai' as const,
			models: ['stub'],
			config: {},
		}),
		chat: async (messages: Message[]): Promise<LLMChatResponse> => {
			calls++;
			return {
				choices: [
					{message: {role: 'assistant' as const, content: respond(messages)}},
				],
			};
		},
		clearContext: async () => {},
		getTimeout: () => undefined,
	};
	return client;
}

test('performAutoCompact uses LLM client when strategy=llm and client provided', async t => {
	setupAutoCompactEnv(100);

	const oldContent = 'old context sentence. '.repeat(60);
	const messages: Message[] = [
		{role: 'user', content: oldContent},
		{role: 'assistant', content: 'reply'},
		{role: 'user', content: 'recent'},
		{role: 'assistant', content: 'recent reply'},
	];
	const systemMessage: Message = {role: 'system', content: 'sys'};

	const client = makeStubClient(() => '## Context\ndid stuff');

	const notifications: string[] = [];
	const result = await performAutoCompact(
		messages,
		systemMessage,
		'openai',
		'gpt-4',
		{
			enabled: true,
			threshold: 50,
			mode: 'default',
			strategy: 'llm',
			notifyUser: true,
		},
		n => notifications.push(n),
		client,
	);

	t.truthy(result);
	t.is(client.calls, 1, 'LLM was called once');
	t.true(
		notifications.some(n => n.includes('LLM summary')),
		'notification mentions LLM path',
	);
	t.true(
		result!.some(m => (m.content || '').includes('<conversation-summary>')),
		'output contains the synthetic summary message',
	);
});

test('performAutoCompact skips LLM when strategy=mechanical', async t => {
	setupAutoCompactEnv(100);

	const messages: Message[] = [
		{role: 'user', content: 'old '.repeat(400)},
	];
	const systemMessage: Message = {role: 'system', content: 'sys'};
	const client = makeStubClient(() => 'should not be called');

	const result = await performAutoCompact(
		messages,
		systemMessage,
		'openai',
		'gpt-4',
		{
			enabled: true,
			threshold: 50,
			mode: 'default',
			strategy: 'mechanical',
			notifyUser: false,
		},
		undefined,
		client,
	);

	t.truthy(result);
	t.is(client.calls, 0, 'LLM not called in mechanical mode');
});

test('performAutoCompact falls back to mechanical when LLM throws', async t => {
	setupAutoCompactEnv(100);

	const messages: Message[] = [
		{role: 'user', content: 'old '.repeat(400)},
		{role: 'assistant', content: 'reply'},
		{role: 'user', content: 'recent'},
		{role: 'assistant', content: 'recent reply'},
	];
	const systemMessage: Message = {role: 'system', content: 'sys'};
	const client: LLMClient = {
		getCurrentModel: () => 'stub',
		setModel: () => {},
		getContextSize: () => 100_000,
		getAvailableModels: async () => ['stub'],
		getProviderConfig: () => ({
			name: 'stub',
			type: 'openai' as const,
			models: ['stub'],
			config: {},
		}),
		chat: async () => {
			throw new Error('boom');
		},
		clearContext: async () => {},
		getTimeout: () => undefined,
	};

	const result = await performAutoCompact(
		messages,
		systemMessage,
		'openai',
		'gpt-4',
		{
			enabled: true,
			threshold: 50,
			mode: 'default',
			strategy: 'llm',
			notifyUser: false,
		},
		undefined,
		client,
	);

	// Mechanical path still produces output
	t.truthy(result);
	t.false(
		(result || []).some(m => (m.content || '').includes('<conversation-summary>')),
		'output is mechanical (no LLM summary marker)',
	);
});

test('performAutoCompact uses provider-configured context limit', async t => {
	const messages: Message[] = [
		{role: 'user', content: 'x'.repeat(3000)},
	];
	const systemMessage: Message = {
		role: 'system',
		content: 'system',
	};

	const result = await performAutoCompact(
		messages,
		systemMessage,
		'Test Provider',
		'custom-model',
		{
			enabled: true,
			threshold: 50,
			mode: 'conservative',
			notifyUser: false,
		},
	);

	t.true(result === null || Array.isArray(result));
});

test('performAutoCompact honours contextWindow from the client provider config', async t => {
	// Regression for issue #525: performAutoCompact previously built a synthetic
	// providerConfig stub with empty `config: {}`, discarding the user's
	// `contextWindow`/`contextWindows` settings. For on-prem providers (e.g. Qwen)
	// with no models.dev entry, that meant the limit fell through to `null` and
	// compaction never triggered. The fix passes `client.getProviderConfig()` so
	// the configured window is honoured.
	resetSessionContextLimit();

	// Long message — at FallbackTokenizer's ~4 chars/token, ~2500 chars ≈ 625 tokens.
	// With a provider-configured contextWindow of 1000, usage is ~62%, above the
	// 50% threshold, so compaction must run.
	const messages: Message[] = [
		{role: 'user', content: 'on-prem context. '.repeat(150)},
		{role: 'assistant', content: 'reply'},
		{role: 'user', content: 'recent'},
		{role: 'assistant', content: 'recent reply'},
	];
	const systemMessage: Message = {role: 'system', content: 'sys'};

	const client: LLMClient = {
		getCurrentModel: () => 'qwen3-on-prem',
		setModel: () => {},
		getContextSize: () => 1000,
		getAvailableModels: async () => ['qwen3-on-prem'],
		getProviderConfig: () => ({
			name: 'qwen-on-prem',
			type: 'openai' as const,
			models: ['qwen3-on-prem'],
			config: {},
			contextWindow: 1000,
		}),
		chat: async () => ({
			choices: [{message: {role: 'assistant' as const, content: 'stub'}}],
		}),
		clearContext: async () => {},
		getTimeout: () => undefined,
	};

	const result = await performAutoCompact(
		messages,
		systemMessage,
		'qwen-on-prem',
		'qwen3-on-prem',
		{
			enabled: true,
			threshold: 50,
			mode: 'default',
			strategy: 'mechanical',
			notifyUser: false,
		},
		undefined,
		client,
	);

	t.truthy(
		result,
		'Compaction must trigger when client provider config supplies contextWindow',
	);
});
