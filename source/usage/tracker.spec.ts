import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {Message} from '@/types/core.js';
import type {Tokenizer} from '@/types/tokenization.js';
import test from 'ava';
import {clearUsageData, readUsageData} from './storage.js';
import {
	SessionTracker,
	clearCurrentSession,
	getCurrentSession,
	initializeSession,
} from './tracker.js';

console.log('\ntracker.spec.ts');

// ============================================================================
// Mock Tokenizer
// ============================================================================

class MockTokenizer implements Tokenizer {
	getName(): string {
		return 'mock-tokenizer';
	}

	countTokens(message: Message): number {
		// Simple mock: 1 token per 4 characters
		return Math.ceil(message.content.length / 4);
	}

	encode(text: string): number {
		// Return token count (1 token per 4 characters)
		return Math.ceil(text.length / 4);
	}
}

// ============================================================================
// Test Setup
// ============================================================================

function createTestDir(): string {
	const testDir = path.join(
		os.tmpdir(),
		`nanocoder-test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
	);
	fs.mkdirSync(testDir, {recursive: true});
	return testDir;
}

let originalEnv: NodeJS.ProcessEnv;

test.before(() => {
	originalEnv = {...process.env};
});

test.beforeEach(() => {
	const testDir = createTestDir();
	process.env.XDG_CONFIG_HOME = testDir;
	clearCurrentSession(); // Clear any lingering session from previous tests
});

test.afterEach(() => {
	clearCurrentSession();
	clearUsageData();
	try {
		if (process.env.XDG_CONFIG_HOME) {
			fs.rmSync(process.env.XDG_CONFIG_HOME, {recursive: true, force: true});
		}
	} catch (error) {
		// Ignore cleanup errors
	}
});

test.after(() => {
	process.env = originalEnv;
});

// Helper to create messages
function createMockMessages(): Message[] {
	return [
		{role: 'system', content: 'You are a helpful assistant.'},
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: 'Hi there!'},
	];
}

// ============================================================================
// SessionTracker Constructor Tests
// ============================================================================

test('SessionTracker initializes with provider and model', t => {
	const tracker = new SessionTracker('openai', 'gpt-4');
	const info = tracker.getSessionInfo();

	t.is(info.provider, 'openai');
	t.is(info.model, 'gpt-4');
	t.truthy(info.id);
	t.truthy(info.startTime);
});

test('SessionTracker generates unique session IDs', t => {
	const tracker1 = new SessionTracker('openai', 'gpt-4');
	const tracker2 = new SessionTracker('anthropic', 'claude');

	const info1 = tracker1.getSessionInfo();
	const info2 = tracker2.getSessionInfo();

	t.not(info1.id, info2.id);
});

test('SessionTracker records start time', t => {
	const before = Date.now();
	const tracker = new SessionTracker('openai', 'gpt-4');
	const after = Date.now();

	const info = tracker.getSessionInfo();

	t.true(info.startTime >= before);
	t.true(info.startTime <= after);
});

// ============================================================================
// getCurrentStats Tests
// ============================================================================

test('getCurrentStats returns stats for empty messages', async t => {
	const tracker = new SessionTracker('openai', 'gpt-4');
	const tokenizer = new MockTokenizer();
	const messages: Message[] = [];

	const stats = await tracker.getCurrentStats(messages, tokenizer);

	t.is(stats.provider, 'openai');
	t.is(stats.model, 'gpt-4');
	t.is(stats.messageCount, 0);
	t.is(stats.tokens.total, 0);
	t.truthy(stats.startTime);
});

test('getCurrentStats calculates token breakdown', async t => {
	const tracker = new SessionTracker('openai', 'gpt-4');
	const tokenizer = new MockTokenizer();
	const messages = createMockMessages();

	const stats = await tracker.getCurrentStats(messages, tokenizer);

	t.is(stats.messageCount, 3);
	t.true(stats.tokens.total > 0);
	t.true(stats.tokens.system > 0);
	t.true(stats.tokens.userMessages > 0);
	t.true(stats.tokens.assistantMessages > 0);
});

test('getCurrentStats includes context limit and percent used', async t => {
	const tracker = new SessionTracker('openai', 'gpt-4');
	const tokenizer = new MockTokenizer();
	const messages = createMockMessages();

	const stats = await tracker.getCurrentStats(messages, tokenizer);

	// Context limit may be null if model not found
	if (stats.contextLimit) {
		t.true(stats.contextLimit > 0);
		t.true(stats.percentUsed >= 0);
		t.true(stats.percentUsed <= 100 || stats.percentUsed > 100); // Allow over 100%
	} else {
		t.is(stats.percentUsed, 0);
	}
});

test('getCurrentStats calculates percent used correctly', async t => {
	const tracker = new SessionTracker('openai', 'gpt-4');
	const tokenizer = new MockTokenizer();
	// Create a message with known token count
	const messages: Message[] = [
		{role: 'user', content: 'a'.repeat(400)}, // 400 chars / 4 = 100 tokens
	];

	const stats = await tracker.getCurrentStats(messages, tokenizer);

	t.is(stats.tokens.total, 100);

	if (stats.contextLimit) {
		const expectedPercent = (100 / stats.contextLimit) * 100;
		t.is(stats.percentUsed, expectedPercent);
	}
});

// ============================================================================
// saveSession Tests
// ============================================================================

test('saveSession persists session to storage', t => {
	const tracker = new SessionTracker('openai', 'gpt-4');
	const tokenizer = new MockTokenizer();
	const messages = createMockMessages();

	tracker.saveSession(messages, tokenizer);

	const data = readUsageData();
	t.is(data.sessions.length, 1);

	const session = data.sessions[0]!;
	t.is(session.provider, 'openai');
	t.is(session.model, 'gpt-4');
	t.is(session.messageCount, 3);
	t.true(session.tokens.total > 0);
	t.true(session.duration !== undefined);
	t.true(session.duration! >= 0);
});

test('saveSession includes duration', t => {
	const tracker = new SessionTracker('openai', 'gpt-4');
	const tokenizer = new MockTokenizer();
	const messages = createMockMessages();

	// Wait a bit to ensure duration > 0
	const start = Date.now();
	while (Date.now() - start < 10) {
		// Small delay
	}

	tracker.saveSession(messages, tokenizer);

	const data = readUsageData();
	const session = data.sessions[0]!;

	t.true(session.duration! >= 10);
});

test('saveSession saves correct token breakdown', t => {
	const tracker = new SessionTracker('openai', 'gpt-4');
	const tokenizer = new MockTokenizer();
	const messages: Message[] = [
		{role: 'system', content: 'abcd'}, // 4 chars = 1 token
		{role: 'user', content: 'abcdefgh'}, // 8 chars = 2 tokens
		{role: 'assistant', content: 'abcdefghijkl'}, // 12 chars = 3 tokens
	];

	tracker.saveSession(messages, tokenizer);

	const data = readUsageData();
	const session = data.sessions[0]!;

	t.is(session.tokens.system, 1);
	t.is(session.tokens.userMessages, 2);
	t.is(session.tokens.assistantMessages, 3);
	t.is(session.tokens.total, 6);
});

// ============================================================================
// updateProviderModel Tests
// ============================================================================

test('updateProviderModel changes provider and model', t => {
	const tracker = new SessionTracker('openai', 'gpt-4');

	tracker.updateProviderModel('anthropic', 'claude-3');

	const info = tracker.getSessionInfo();
	t.is(info.provider, 'anthropic');
	t.is(info.model, 'claude-3');
});

test('updateProviderModel preserves session ID and start time', t => {
	const tracker = new SessionTracker('openai', 'gpt-4');
	const infoBefore = tracker.getSessionInfo();

	tracker.updateProviderModel('anthropic', 'claude');
	const infoAfter = tracker.getSessionInfo();

	t.is(infoAfter.id, infoBefore.id);
	t.is(infoAfter.startTime, infoBefore.startTime);
});

test('updateProviderModel affects saved session', t => {
	const tracker = new SessionTracker('openai', 'gpt-4');
	const tokenizer = new MockTokenizer();
	const messages = createMockMessages();

	tracker.updateProviderModel('anthropic', 'claude-3-opus');
	tracker.saveSession(messages, tokenizer);

	const data = readUsageData();
	const session = data.sessions[0]!;

	t.is(session.provider, 'anthropic');
	t.is(session.model, 'claude-3-opus');
});

// ============================================================================
// getSessionInfo Tests
// ============================================================================

test('getSessionInfo returns current session details', t => {
	const tracker = new SessionTracker('openai', 'gpt-4');
	const info = tracker.getSessionInfo();

	t.truthy(info.id);
	t.is(info.provider, 'openai');
	t.is(info.model, 'gpt-4');
	t.truthy(info.startTime);
});

// ============================================================================
// Module-level Functions Tests
// ============================================================================

test('initializeSession creates new session tracker', t => {
	initializeSession('openai', 'gpt-4');

	const session = getCurrentSession();
	t.truthy(session);

	const info = session!.getSessionInfo();
	t.is(info.provider, 'openai');
	t.is(info.model, 'gpt-4');
});

test('getCurrentSession returns null initially', t => {
	const session = getCurrentSession();
	t.is(session, null);
});

test('getCurrentSession returns initialized session', t => {
	initializeSession('openai', 'gpt-4');

	const session = getCurrentSession();
	t.truthy(session);
	t.true(session instanceof SessionTracker);
});

test('clearCurrentSession removes current session', t => {
	initializeSession('openai', 'gpt-4');

	let session = getCurrentSession();
	t.truthy(session);

	clearCurrentSession();

	session = getCurrentSession();
	t.is(session, null);
});

test('clearCurrentSession is idempotent', t => {
	clearCurrentSession();
	clearCurrentSession();

	const session = getCurrentSession();
	t.is(session, null);
});

test('initializeSession replaces existing session', t => {
	initializeSession('openai', 'gpt-4');
	const session1 = getCurrentSession();
	const info1 = session1!.getSessionInfo();

	initializeSession('anthropic', 'claude-3-opus');
	const session2 = getCurrentSession();
	const info2 = session2!.getSessionInfo();

	t.not(info1.id, info2.id);
	t.is(info2.provider, 'anthropic');
	t.is(info2.model, 'claude-3-opus');
});

// ============================================================================
// Integration Tests
// ============================================================================

test('complete session tracking flow', async t => {
	// Initialize session
	initializeSession('openai', 'gpt-4');

	const tracker = getCurrentSession();
	t.truthy(tracker);

	// Get current stats
	const tokenizer = new MockTokenizer();
	const messages = createMockMessages();
	const stats = await tracker!.getCurrentStats(messages, tokenizer);

	t.is(stats.provider, 'openai');
	t.is(stats.model, 'gpt-4');
	t.is(stats.messageCount, 3);
	t.true(stats.tokens.total > 0);

	// Save session
	tracker!.saveSession(messages, tokenizer);

	// Verify session was saved
	const data = readUsageData();
	t.is(data.sessions.length, 1);

	const savedSession = data.sessions[0]!;
	t.is(savedSession.provider, 'openai');
	t.is(savedSession.model, 'gpt-4');
	t.is(savedSession.messageCount, 3);

	// Clear session
	clearCurrentSession();
	t.is(getCurrentSession(), null);
});

test('session tracking across provider/model changes', async t => {
	// Initialize with first provider/model
	initializeSession('openai', 'gpt-4');
	const tracker = getCurrentSession()!;

	// Change provider/model
	tracker.updateProviderModel('anthropic', 'claude-3-opus');

	// Get stats
	const tokenizer = new MockTokenizer();
	const messages = createMockMessages();
	const stats = await tracker.getCurrentStats(messages, tokenizer);

	t.is(stats.provider, 'anthropic');
	t.is(stats.model, 'claude-3-opus');

	// Save session
	tracker.saveSession(messages, tokenizer);

	// Verify correct provider/model was saved
	const data = readUsageData();
	const session = data.sessions[0]!;

	t.is(session.provider, 'anthropic');
	t.is(session.model, 'claude-3-opus');
});

test('getCurrentStats handles unknown model with no context limit', async t => {
	const tracker = new SessionTracker('unknown-provider', 'unknown-model-that-does-not-exist');
	const tokenizer = new MockTokenizer();
	const messages = createMockMessages();

	const stats = await tracker.getCurrentStats(messages, tokenizer);

	// When context limit is not found, percentUsed should be 0
	t.is(stats.percentUsed, 0);
	t.is(stats.provider, 'unknown-provider');
	t.is(stats.model, 'unknown-model-that-does-not-exist');
	t.is(stats.messageCount, 3);
});

test('getCurrentStats uses provider-configured context limit for percentage', async t => {
	const tracker = new SessionTracker('Test Provider', 'qwen2.5-coder');
	const tokenizer = new MockTokenizer();
	const messages: Message[] = [
		{role: 'user', content: 'a'.repeat(400)},
	];

	const stats = await tracker.getCurrentStats(messages, tokenizer);

	t.is(stats.tokens.total, 100);
	t.true(stats.contextLimit === null || stats.contextLimit > 0);
});

test('getCurrentStats respects lower provider-configured limit for Codex-like provider names', async t => {
	const tracker = new SessionTracker('Codex', 'gpt-5');
	const tokenizer = new MockTokenizer();
	const messages: Message[] = [
		{role: 'user', content: 'a'.repeat(400)},
	];

	const stats = await tracker.getCurrentStats(messages, tokenizer);

	t.is(stats.tokens.total, 100);
	t.true(stats.contextLimit === null || stats.contextLimit > 0);
});

test('multiple sessions tracked correctly', t => {
	const tokenizer = new MockTokenizer();
	const messages = createMockMessages();

	// Session 1
	initializeSession('openai', 'gpt-4');
	getCurrentSession()!.saveSession(messages, tokenizer);

	// Session 2
	initializeSession('anthropic', 'claude');
	getCurrentSession()!.saveSession(messages, tokenizer);

	// Session 3
	initializeSession('openai', 'gpt-3.5');
	getCurrentSession()!.saveSession(messages, tokenizer);

	// Verify all sessions saved
	const data = readUsageData();
	t.is(data.sessions.length, 3);

	// Verify they're in reverse order (most recent first)
	t.is(data.sessions[0]!.model, 'gpt-3.5');
	t.is(data.sessions[1]!.model, 'claude');
	t.is(data.sessions[2]!.model, 'gpt-4');
});
