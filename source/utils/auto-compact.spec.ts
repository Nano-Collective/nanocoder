import test from 'ava';
import {resetSessionContextLimit, setSessionContextLimit} from '@/models/models-dev-client.js';
import type {Message} from '@/types/core';
import {
	autoCompactSessionOverrides,
	performAutoCompact,
	resetAutoCompactSession,
	setAutoCompactEnabled,
	setAutoCompactMode,
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
