import test from 'ava';
import {
	resetSessionContextLimit,
	setSessionContextLimit,
} from '@/models/index';
import {createTokenizer} from '@/tokenization/index';
import type {LLMChatResponse, LLMClient, Message} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {
	AGGRESSIVE_COMPACT_THRESHOLD,
	applyTuneCompaction,
	autoCompactSessionOverrides,
	maybeAutoCompact,
	performAutoCompact,
	resetAutoCompactSession,
	resolveAutoCompactSettings,
	setAutoCompactEnabled,
	setAutoCompactMode,
	setAutoCompactStrategy,
	setAutoCompactThreshold,
} from './auto-compact';
import {COMPRESSION_CONSTANTS} from './message-compression';

// Reset session overrides before each test
test.beforeEach(() => {
	resetAutoCompactSession();
	resetSessionContextLimit();
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

test('setAutoCompactThreshold clamps to the configured minimum', t => {
	setAutoCompactThreshold(COMPRESSION_CONSTANTS.MIN_THRESHOLD_PERCENT - 20);
	t.is(
		autoCompactSessionOverrides.threshold,
		COMPRESSION_CONSTANTS.MIN_THRESHOLD_PERCENT,
	);
});

test('setAutoCompactThreshold clamps to the configured maximum', t => {
	setAutoCompactThreshold(COMPRESSION_CONSTANTS.MAX_THRESHOLD_PERCENT + 4);
	t.is(
		autoCompactSessionOverrides.threshold,
		COMPRESSION_CONSTANTS.MAX_THRESHOLD_PERCENT,
	);
});

test('setAutoCompactThreshold handles the configured minimum', t => {
	setAutoCompactThreshold(COMPRESSION_CONSTANTS.MIN_THRESHOLD_PERCENT);
	t.is(
		autoCompactSessionOverrides.threshold,
		COMPRESSION_CONSTANTS.MIN_THRESHOLD_PERCENT,
	);
});

test('setAutoCompactThreshold handles the configured maximum', t => {
	setAutoCompactThreshold(COMPRESSION_CONSTANTS.MAX_THRESHOLD_PERCENT);
	t.is(
		autoCompactSessionOverrides.threshold,
		COMPRESSION_CONSTANTS.MAX_THRESHOLD_PERCENT,
	);
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

// ==================== Tune aggressive compact layer ====================

const baseConfig = {
	enabled: true,
	threshold: 70,
	mode: 'conservative' as const,
	strategy: 'llm' as const,
};

test('resolveAutoCompactSettings uses config when nothing overrides it', t => {
	const resolved = resolveAutoCompactSettings(baseConfig);
	t.is(resolved.threshold, 70);
	t.is(resolved.mode, 'conservative');
	t.is(resolved.strategy, 'llm');
	t.false(resolved.hasOverrides);
});

test('tune aggressive compact lowers threshold to the minimum and sets aggressive mode', t => {
	applyTuneCompaction({
		enabled: true,
		toolProfile: 'auto',
		aggressiveCompact: true,
	});
	const resolved = resolveAutoCompactSettings(baseConfig);
	t.is(resolved.threshold, AGGRESSIVE_COMPACT_THRESHOLD);
	t.is(AGGRESSIVE_COMPACT_THRESHOLD, COMPRESSION_CONSTANTS.MIN_THRESHOLD_PERCENT);
	t.is(resolved.mode, 'aggressive');
	t.true(resolved.hasOverrides);
});

test('tune aggressive compact is ignored when tune is disabled', t => {
	applyTuneCompaction({
		enabled: false,
		toolProfile: 'auto',
		aggressiveCompact: true,
	});
	t.is(resolveAutoCompactSettings(baseConfig).threshold, 70);
});

test('explicit /compact session overrides beat tune aggressive compact', t => {
	setAutoCompactThreshold(85);
	setAutoCompactMode('default');
	applyTuneCompaction({
		enabled: true,
		toolProfile: 'auto',
		aggressiveCompact: true,
	});
	const resolved = resolveAutoCompactSettings(baseConfig);
	t.is(resolved.threshold, 85);
	t.is(resolved.mode, 'default');
});

test('turning tune aggressive compact off keeps a user threshold override', t => {
	setAutoCompactThreshold(85);
	applyTuneCompaction({
		enabled: true,
		toolProfile: 'auto',
		aggressiveCompact: true,
	});
	applyTuneCompaction({
		enabled: true,
		toolProfile: 'auto',
		aggressiveCompact: false,
	});
	t.is(autoCompactSessionOverrides.threshold, 85);
	t.is(resolveAutoCompactSettings(baseConfig).mode, 'conservative');
});

test('a caller\'s own aggressive-compact preset is used instead of the process-wide one', t => {
	applyTuneCompaction({
		enabled: true,
		toolProfile: 'auto',
		aggressiveCompact: true,
	});
	// The process-wide preset is on, but this caller has its own, which is off.
	const own = resolveAutoCompactSettings(baseConfig, false);
	t.is(own.threshold, 70);
	t.is(own.mode, 'conservative');
	t.false(own.hasOverrides);
	t.is(resolveAutoCompactSettings(baseConfig).threshold, AGGRESSIVE_COMPACT_THRESHOLD);

	// And the other way round: on for this caller, off process-wide.
	applyTuneCompaction(undefined);
	const aggressive = resolveAutoCompactSettings(baseConfig, true);
	t.is(aggressive.threshold, AGGRESSIVE_COMPACT_THRESHOLD);
	t.is(aggressive.mode, 'aggressive');
	t.true(aggressive.hasOverrides);
	t.is(resolveAutoCompactSettings(baseConfig).threshold, 70);
});

test('the caller\'s preset still sits below explicit /compact overrides', t => {
	setAutoCompactThreshold(85);
	setAutoCompactMode('default');
	const resolved = resolveAutoCompactSettings(baseConfig, true);
	t.is(resolved.threshold, 85);
	t.is(resolved.mode, 'default');
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
	// 6,000-token window, 50% threshold → needs ≥3,000 tokens. Neither the
	// messages (~2,000 tokens) nor the fixed overhead (~2,030 tokens) crosses
	// 3,000 alone, so only their sum (~4,030 tokens) trips the gate.
	setupAutoCompactEnv(6000);

	const messages: Message[] = [
		{
			role: 'user',
			content: Array.from({length: 1000}, (_, i) => `word${i}`).join(' '),
		},
	];
	const systemMessage: Message = {
		role: 'system',
		content: 'You are a helpful assistant.',
	};
	// A tool definition built from distinct words so it tokenizes to ~2,020
	// tokens under *any* tokenizer (avoids BPE run-merging): under the 3,000-token
	// gate on its own, yet pushes the conversation past it when combined.
	const bigDescription = Array.from(
		{length: 1000},
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
	t.is(notifications[0], 'auto-compacting context...');
	t.true(
		notifications.some(n => n.includes('LLM summary')),
		'notification mentions LLM path',
	);
	t.true(
		result!.some(m => (m.content || '').includes('<conversation-summary>')),
		'output contains the synthetic summary message',
	);
});

test('performAutoCompact notifies before the LLM summariser call', async t => {
	setupAutoCompactEnv(100);

	const order: string[] = [];
	const messages: Message[] = [
		{role: 'user', content: 'old context sentence. '.repeat(60)},
		{role: 'assistant', content: 'reply'},
		{role: 'user', content: 'recent'},
		{role: 'assistant', content: 'recent reply'},
	];
	const client = makeStubClient(() => {
		order.push('chat');
		return '## Context\ndid stuff';
	});

	await performAutoCompact(
		messages,
		{role: 'system', content: 'sys'},
		'openai',
		'gpt-4',
		{
			enabled: true,
			threshold: 50,
			mode: 'default',
			strategy: 'llm',
			notifyUser: true,
		},
		n => order.push(n),
		client,
	);

	t.is(order[0], 'auto-compacting context...');
	t.is(order[1], 'chat');
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
	const notifications: string[] = [];
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
			notifyUser: true,
		},
		n => notifications.push(n),
		client,
	);

	// Mechanical path still produces output
	t.truthy(result);
	t.false(
		(result || []).some(m => (m.content || '').includes('<conversation-summary>')),
		'output is mechanical (no LLM summary marker)',
	);
	t.true(
		notifications.at(-1)?.includes('(summary degraded: LLM call failed)'),
		'fallback notification identifies the failed LLM summary',
	);
});

test('performAutoCompact reports degraded fallback when LLM returns an empty summary', async t => {
	setupAutoCompactEnv(100);

	const messages: Message[] = [
		{role: 'user', content: 'old '.repeat(400)},
		{role: 'assistant', content: 'reply'},
		{role: 'user', content: 'recent'},
		{role: 'assistant', content: 'recent reply'},
	];
	const systemMessage: Message = {role: 'system', content: 'sys'};
	const notifications: string[] = [];
	const client = makeStubClient(() => '   ');

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
	t.is(client.calls, 1, 'the LLM was called and returned an empty summary');
	t.false(
		(result || []).some(m => (m.content || '').includes('<conversation-summary>')),
		'output is mechanical (no LLM summary marker)',
	);
	t.true(
		notifications.at(-1)?.includes('(summary degraded: LLM call failed)'),
		'fallback notification identifies the failed LLM summary',
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

test('maybeAutoCompact returns the same array when auto-compact is off', async t => {
	setAutoCompactEnabled(false);

	const messages: Message[] = [{role: 'user', content: 'hi'}];
	const client = {
		getCurrentModel: () => 'gpt-4',
		getProviderConfig: () => ({name: 'openai'}),
	} as unknown as LLMClient;

	const result = await maybeAutoCompact(
		messages,
		{role: 'system', content: 'You are a helpful assistant.'},
		client,
	);

	t.is(result, messages);
});

test('maybeAutoCompact returns history without a system role when over threshold', async t => {
	setupAutoCompactEnv(100);
	setAutoCompactStrategy('mechanical');
	setAutoCompactThreshold(50);

	const oldContent = 'old context sentence. '.repeat(60);
	const messages: Message[] = [
		{role: 'user', content: oldContent},
		{role: 'assistant', content: 'ack'},
		{role: 'user', content: oldContent},
		{role: 'assistant', content: 'ack'},
		{role: 'user', content: 'recent question'},
	];
	const client = {
		getCurrentModel: () => 'gpt-4',
		getProviderConfig: () => ({name: 'openai'}),
	} as unknown as LLMClient;

	const result = await maybeAutoCompact(
		messages,
		{role: 'system', content: 'You are a helpful assistant.'},
		client,
	);

	t.not(result, messages);
	t.false(result.some(msg => msg.role === 'system'));
	t.true(
		result.some(
			msg =>
				typeof msg.content === 'string' && msg.content.length < oldContent.length,
		),
		'mechanical compact must shrink an earlier oversized user turn',
	);
});

test('maybeAutoCompact skips mechanical fallback when aborted during LLM summarise', async t => {
	setupAutoCompactEnv(100);
	setAutoCompactStrategy('llm');
	setAutoCompactThreshold(50);

	const oldContent = 'old context sentence. '.repeat(60);
	const messages: Message[] = [
		{role: 'user', content: oldContent},
		{role: 'assistant', content: 'ack'},
		{role: 'user', content: oldContent},
		{role: 'assistant', content: 'ack'},
		{role: 'user', content: 'recent question'},
	];
	const controller = new AbortController();
	const client = {
		getCurrentModel: () => 'gpt-4',
		getProviderConfig: () => ({name: 'openai'}),
		chat: async (
			_messages: Message[],
			_tools?: unknown,
			_callbacks?: unknown,
			signal?: AbortSignal,
		) => {
			controller.abort();
			if (signal?.aborted) {
				throw new Error('aborted');
			}
			return {choices: [{message: {content: 'summary'}}]};
		},
	} as unknown as LLMClient;

	const result = await maybeAutoCompact(
		messages,
		{role: 'system', content: 'You are a helpful assistant.'},
		client,
		undefined,
		{signal: controller.signal},
	);

	t.is(result, messages);
});

test('maybeAutoCompact returns the same array when the abort signal is already aborted', async t => {
	setupAutoCompactEnv(100);
	setAutoCompactStrategy('mechanical');
	setAutoCompactThreshold(50);

	const messages: Message[] = [
		{role: 'user', content: 'old context sentence. '.repeat(60)},
	];
	const client = {
		getCurrentModel: () => 'gpt-4',
		getProviderConfig: () => ({name: 'openai'}),
	} as unknown as LLMClient;
	const signal = AbortSignal.abort();

	const result = await maybeAutoCompact(
		messages,
		{role: 'system', content: 'You are a helpful assistant.'},
		client,
		undefined,
		{signal},
	);

	t.is(result, messages);
});

test('maybeAutoCompact leaves history unchanged when performAutoCompact throws', async t => {
	setupAutoCompactEnv(100);
	setAutoCompactEnabled(true);

	const messages: Message[] = [{role: 'user', content: 'hi'}];
	const client = {
		getCurrentModel: () => {
			throw new Error('boom');
		},
		getProviderConfig: () => ({name: 'openai'}),
	} as unknown as LLMClient;

	const result = await maybeAutoCompact(
		messages,
		{role: 'system', content: 'You are a helpful assistant.'},
		client,
	);

	t.is(result, messages);
});

test('maybeAutoCompact omits native tools from the gate when toolsDisabled', async t => {
	setupAutoCompactEnv(6000);
	setAutoCompactStrategy('mechanical');
	setAutoCompactThreshold(50);

	const nativeTools = {
		big_tool: tool({
			description: Array.from({length: 1000}, (_, i) => `param${i}`).join(' '),
			inputSchema: jsonSchema<Record<string, never>>({type: 'object'}),
		}),
	};
	const messages: Message[] = [
		{
			role: 'user',
			content: Array.from({length: 1000}, (_, i) => `word${i}`).join(' '),
		},
	];
	const systemMessage: Message = {
		role: 'system',
		content: 'You are a helpful assistant.',
	};
	const client = {
		getCurrentModel: () => 'gpt-4',
		getProviderConfig: () => ({name: 'openai'}),
	} as unknown as LLMClient;

	const without = await maybeAutoCompact(messages, systemMessage, client);
	t.is(without, messages);

	const withTools = await maybeAutoCompact(
		messages,
		systemMessage,
		client,
		nativeTools,
	);
	t.not(withTools, messages);
});

test('maybeAutoCompact skips compaction and warns once when fixed overhead exceeds the limit', async t => {
	// Regression for #2404: when system prompt + tool definitions already exceed
	// the context limit (e.g. /context-max 8k with default tools), compacting
	// messages can never bring usage under the threshold and must not run or
	// invoke the LLM summariser after every turn.
	setupAutoCompactEnv(8000);
	setAutoCompactStrategy('llm');
	setAutoCompactThreshold(80);

	const systemMessage: Message = {
		role: 'system',
		content: Array.from({length: 2500}, (_, i) => `rule${i}`).join(' '),
	};
	const nativeTools = {
		big_tool: tool({
			description: Array.from({length: 4000}, (_, i) => `toolparam${i}`).join(
				' ',
			),
			inputSchema: jsonSchema<Record<string, never>>({type: 'object'}),
		}),
	};
	const client = makeStubClient(() => '## Context\nshould not be called');
	const notifications: string[] = [];

	// Turn 1: short exchange, fixed overhead alone exceeds 8k limit.
	const turn1: Message[] = [
		{role: 'user', content: 'hi'},
		{role: 'assistant', content: 'hello'},
	];
	const res1 = await maybeAutoCompact(turn1, systemMessage, client, nativeTools, {
		onNotify: msg => notifications.push(msg),
	});

	t.is(res1, turn1, 'turn 1 must skip compaction and return messages unchanged');
	t.is(client.calls, 0, 'summariser must not be called on turn 1');
	t.is(notifications.length, 1, 'warning must be shown once on turn 1');
	t.true(
		notifications[0].includes('system prompt and tool definitions'),
		'warning should name system prompt and tool definitions',
	);
	t.true(
		notifications[0].includes('8,000 tokens'),
		'warning should include the context limit',
	);
	t.true(
		notifications[0].includes('/tune') && notifications[0].includes('nano'),
		'warning should name /tune and a smaller tool profile',
	);

	// Turn 2: more messages (enough that summariseWithLLM would otherwise run).
	// Neither compaction nor the warning should fire again.
	const turn2: Message[] = [
		...turn1,
		{role: 'user', content: 'second message'},
		{role: 'assistant', content: 'second reply'},
	];
	const res2 = await maybeAutoCompact(turn2, systemMessage, client, nativeTools, {
		onNotify: msg => notifications.push(msg),
	});

	t.is(res2, turn2, 'turn 2 must still skip compaction');
	t.is(client.calls, 0, 'summariser must not be called on turn 2');
	t.is(notifications.length, 1, 'warning must not repeat on turn 2');

	// A subagent call in the same session has smaller fixed overhead (under the
	// threshold) and passes no onNotify; it must not reset the parent's warning.
	await maybeAutoCompact(
		[{role: 'user', content: 'subagent task'}],
		{role: 'system', content: 'Short subagent prompt.'},
		client,
	);
	const res3 = await maybeAutoCompact(turn2, systemMessage, client, nativeTools, {
		onNotify: msg => notifications.push(msg),
	});
	t.is(res3, turn2, 'turn 3 must still skip compaction');
	t.is(
		notifications.length,
		1,
		'warning must not repeat after a smaller subagent call in the same session',
	);
});

test('maybeAutoCompact re-warns once when the context limit changes and still cannot fit fixed overhead', async t => {
	setupAutoCompactEnv(1000);
	setAutoCompactStrategy('llm');
	setAutoCompactThreshold(80);

	const systemMessage: Message = {
		role: 'system',
		content: Array.from({length: 1000}, (_, i) => `rule${i}`).join(' '),
	};
	const client = makeStubClient(() => '## Context\nshould not be called');
	const notifications: string[] = [];
	const messages: Message[] = [
		{role: 'user', content: 'turn 1'},
		{role: 'assistant', content: 'reply 1'},
		{role: 'user', content: 'turn 2'},
		{role: 'assistant', content: 'reply 2'},
	];

	await maybeAutoCompact(messages, systemMessage, client, undefined, {
		onNotify: msg => notifications.push(msg),
	});
	t.is(notifications.length, 1);
	t.true(
		notifications[0].includes('system prompt uses'),
		'warning without native tools should refer to system prompt',
	);

	// Changing to another too-small limit surfaces one updated warning.
	setSessionContextLimit(1200);
	await maybeAutoCompact(messages, systemMessage, client, undefined, {
		onNotify: msg => notifications.push(msg),
	});
	await maybeAutoCompact(messages, systemMessage, client, undefined, {
		onNotify: msg => notifications.push(msg),
	});
	t.is(notifications.length, 2, 'new limit warns once, not twice');
	t.true(notifications[1].includes('1,200 tokens'));
	t.is(client.calls, 0);
});

test('performAutoCompact skips while total fits and compacts once total reaches limit when fixed overhead sits between threshold and limit', async t => {
	// Fixed overhead (~250 tokens for system prompt) sits between the 50%
	// threshold (200 tokens) and the 400-token context limit.
	setupAutoCompactEnv(400);

	const systemMessage: Message = {
		role: 'system',
		content: Array.from({length: 120}, (_, i) => `directive${i}`).join(' '),
	};
	const config = {
		enabled: true,
		threshold: 50,
		mode: 'default' as const,
		strategy: 'llm' as const,
		notifyUser: true,
	};
	const client = makeStubClient(() => '## Context\nBrief summary.');
	const notifications: string[] = [];

	// While total usage still fits under the 400-token limit, skip compaction
	// and emit the fixed-overhead warning once.
	const fittingTurn1: Message[] = [
		{role: 'user', content: 'first message'},
		{role: 'assistant', content: 'first reply'},
		{role: 'user', content: 'second message'},
		{role: 'assistant', content: 'second reply'},
	];
	const res1 = await performAutoCompact(
		fittingTurn1,
		systemMessage,
		'custom',
		'generic-model',
		config,
		msg => notifications.push(msg),
		client,
	);
	t.is(res1, null, 'must skip compaction while total still fits in the limit');
	t.is(client.calls, 0, 'must not call summariser while total fits');
	t.is(notifications.length, 1, 'must emit warning once');
	t.true(
		notifications[0].includes('Auto-compaction skipped') &&
			notifications[0].includes('/tune'),
		'warning should explain the skip and point to /tune',
	);

	// Another turn that still fits must stay skipped without repeating the warning.
	const fittingTurn2: Message[] = [
		...fittingTurn1,
		{role: 'user', content: 'third message'},
		{role: 'assistant', content: 'third reply'},
	];
	const res2 = await performAutoCompact(
		fittingTurn2,
		systemMessage,
		'custom',
		'generic-model',
		config,
		msg => notifications.push(msg),
		client,
	);
	t.is(res2, null, 'second fitting turn must also skip compaction');
	t.is(client.calls, 0, 'must still not call summariser');
	t.is(notifications.length, 1, 'must not repeat warning on subsequent fitting turn');

	// Once conversation history pushes total usage to/past the 400-token limit,
	// compaction must run so the next request fits in the window.
	const overflowMessages: Message[] = [
		{
			role: 'user',
			content: Array.from({length: 120}, (_, i) => `history${i}`).join(' '),
		},
		{role: 'assistant', content: 'acknowledged'},
		{role: 'user', content: 'latest question'},
		{role: 'assistant', content: 'latest answer'},
	];
	const compacted = await performAutoCompact(
		overflowMessages,
		systemMessage,
		'custom',
		'generic-model',
		config,
		msg => notifications.push(msg),
		client,
	);
	t.truthy(
		compacted,
		'must still compact once total usage reaches the context limit',
	);
	t.is(client.calls, 1, 'must invoke summariser LLM when total hits the limit');
	t.true(
		compacted!.some(m => (m.content || '').includes('<conversation-summary>')),
		'compacted history must contain the LLM summary',
	);

	// After compaction brings total back under the limit, skipping resumes
	// without re-emitting the fixed-overhead warning for the same limit/threshold.
	const skipWarningsBefore = notifications.filter(n =>
		n.includes('Auto-compaction skipped'),
	).length;
	const afterCompact = await performAutoCompact(
		compacted!,
		systemMessage,
		'custom',
		'generic-model',
		config,
		msg => notifications.push(msg),
		client,
	);
	t.is(
		afterCompact,
		null,
		'post-compaction history that fits under the limit must skip again',
	);
	t.is(client.calls, 1, 'must not re-invoke summariser after history fits again');
	const skipWarningsAfter = notifications.filter(n =>
		n.includes('Auto-compaction skipped'),
	).length;
	t.is(
		skipWarningsAfter,
		skipWarningsBefore,
		'must not re-emit the fixed-overhead warning after compacting back under the limit',
	);
});

test('performAutoCompact compacts when fixed overhead sits in the threshold..limit band and total is past the halfway point but still under the limit', async t => {
	const contextLimit = 400;
	setupAutoCompactEnv(contextLimit);

	const systemMessage: Message = {
		role: 'system',
		content: Array.from({length: 120}, (_, i) => `directive${i}`).join(' '),
	};
	const messages: Message[] = [
		{
			role: 'user',
			content: Array.from({length: 35}, (_, i) => `topic${i}`).join(' '),
		},
		{role: 'assistant', content: 'acknowledged'},
		{role: 'user', content: 'follow-up question'},
		{role: 'assistant', content: 'follow-up answer'},
	];

	// Verify the fixture actually falls in the target region:
	// threshold < fixed < halfway <= total < contextLimit.
	const tokenizer = createTokenizer('custom', 'generic-model');
	try {
		const fixedTokens = tokenizer.countTokens(systemMessage);
		const conversationTokens = messages.reduce(
			(sum, msg) => sum + tokenizer.countTokens(msg),
			0,
		);
		const totalTokens = fixedTokens + conversationTokens;
		const halfway = fixedTokens + (contextLimit - fixedTokens) / 2;
		t.true(
			fixedTokens >= contextLimit * 0.5 && fixedTokens < contextLimit,
			`expected fixedTokens (${fixedTokens}) in [200, 400)`,
		);
		t.true(
			totalTokens >= halfway && totalTokens < contextLimit,
			`expected totalTokens (${totalTokens}) in [${halfway}, ${contextLimit})`,
		);
	} finally {
		tokenizer.free?.();
	}

	const client = makeStubClient(() => '## Context\nBrief summary.');
	const notifications: string[] = [];
	const compacted = await performAutoCompact(
		messages,
		systemMessage,
		'custom',
		'generic-model',
		{
			enabled: true,
			threshold: 50,
			mode: 'default',
			strategy: 'llm',
			notifyUser: true,
		},
		msg => notifications.push(msg),
		client,
	);

	t.truthy(
		compacted,
		'must compact once total usage crosses the halfway point to the limit',
	);
	t.is(client.calls, 1, 'must invoke summariser LLM past the halfway point');
	t.true(
		compacted!.some(m => (m.content || '').includes('<conversation-summary>')),
		'compacted history must contain the LLM summary',
	);
	t.false(
		notifications.some(n => n.includes('Auto-compaction skipped')),
		'must not emit a skip warning when compaction runs',
	);
});

test('maybeAutoCompact still compacts normally when fixed overhead is under threshold and messages exceed it', async t => {
	setupAutoCompactEnv(2000);
	setAutoCompactStrategy('llm');
	setAutoCompactThreshold(50);

	const systemMessage: Message = {
		role: 'system',
		content: 'You are a helpful assistant.',
	};
	const nativeTools = {
		small_tool: tool({
			description: 'Read a file from disk.',
			inputSchema: jsonSchema<Record<string, never>>({type: 'object'}),
		}),
	};
	const bigTurn = Array.from({length: 900}, (_, i) => `detail${i}`).join(' ');
	const messages: Message[] = [
		{role: 'user', content: bigTurn},
		{role: 'assistant', content: 'acknowledged'},
		{role: 'user', content: 'latest question'},
		{role: 'assistant', content: 'latest answer'},
	];
	const client = makeStubClient(() => '## Context\nBrief summary.');
	const notifications: string[] = [];

	const result = await maybeAutoCompact(
		messages,
		systemMessage,
		client,
		nativeTools,
		{onNotify: msg => notifications.push(msg)},
	);

	t.not(result, messages, 'normal case must still compact');
	t.is(client.calls, 1, 'LLM summariser must run once');
	t.true(
		result.some(m => (m.content || '').includes('<conversation-summary>')),
		'compacted history must contain the LLM summary',
	);
	t.false(
		notifications.some(n => n.includes('Auto-compaction skipped')),
		'must not emit the fixed-overhead warning',
	);
});

test('maybeAutoCompact uses caller-supplied provider and model over the client', async t => {
	setupAutoCompactEnv(100);
	setAutoCompactStrategy('mechanical');
	setAutoCompactThreshold(50);

	const oldContent = 'old context sentence. '.repeat(60);
	const messages: Message[] = [
		{role: 'user', content: oldContent},
		{role: 'assistant', content: 'ack'},
		{role: 'user', content: oldContent},
		{role: 'assistant', content: 'ack'},
		{role: 'user', content: 'recent question'},
	];
	// A client that cannot report its provider/model — the TUI supplies both
	// from app state, so compaction must still run rather than being swallowed
	// by the catch in maybeAutoCompact.
	const client = {} as unknown as LLMClient;

	const result = await maybeAutoCompact(
		messages,
		{role: 'system', content: 'You are a helpful assistant.'},
		client,
		undefined,
		{provider: 'openai', model: 'gpt-4'},
	);

	t.not(result, messages, 'compaction must run on the caller-supplied model');
});
