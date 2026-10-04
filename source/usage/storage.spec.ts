import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'ava';
import type {SessionUsage, TokenBreakdown, UsageData} from '../types/usage.js';
import {
	addSession,
	clearUsageData,
	getLastNDaysAggregate,
	getTodayAggregate,
	readUsageData,
	writeUsageData,
} from './storage.js';

console.log('\nstorage.spec.ts');

// ============================================================================
// Test Setup
// ============================================================================

// Create a temporary test directory for each test
function createTestDir(): string {
	const testDir = path.join(
		os.tmpdir(),
		`nanocoder-test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
	);
	fs.mkdirSync(testDir, {recursive: true});
	return testDir;
}

// Use XDG_DATA_HOME to control app data directory for tests
let originalEnv: NodeJS.ProcessEnv;

test.before(() => {
	originalEnv = {...process.env};
});

test.beforeEach(() => {
	// Create a fresh test directory for each test
	const testDir = createTestDir();
	// Override XDG_DATA_HOME to point to test directory. NANOCODER_DATA_DIR
	// (set suite-wide in the AVA config) wins over XDG_DATA_HOME, so drop it
	// or the migration target would not be this test's directory.
	process.env.XDG_DATA_HOME = testDir;
	delete process.env.NANOCODER_DATA_DIR;
	// Clear any existing data
	clearUsageData();
});

test.afterEach(() => {
	// Clear usage data first
	clearUsageData();
	// Clean up test directory
	try {
		if (process.env.XDG_DATA_HOME) {
			fs.rmSync(process.env.XDG_DATA_HOME, {recursive: true, force: true});
		}
	} catch (error) {
		// Ignore cleanup errors
	}
});

test.after(() => {
	process.env = originalEnv;
});

// ============================================================================
// Migration Tests
// ============================================================================

test('migrates usage data from legacy config directory to app data directory', t => {
	// Arrange: create a legacy usage.json at the old config location.
	// Legacy usage.json lived in the config directory (getConfigPath()).
	// When NANOCODER_CONFIG_DIR is set, getConfigPath() returns it directly.
	// So here we create a fake legacy config dir and point NANOCODER_CONFIG_DIR at it.
	const legacyConfigDir = path.join(os.tmpdir(), 'nanocoder-legacy-config');
	fs.mkdirSync(legacyConfigDir, {recursive: true});

	const legacyFilePath = path.join(legacyConfigDir, 'usage.json');
	const legacyData: UsageData = {
		sessions: [createMockSession('legacy', 'model', 123)],
		dailyAggregates: [],
		totalLifetime: 123,
		lastUpdated: Date.now(),
	};
	fs.writeFileSync(legacyFilePath, JSON.stringify(legacyData), 'utf-8');

	// Point NANOCODER_CONFIG_DIR to our legacy config dir to simulate pre-change behavior
	process.env.NANOCODER_CONFIG_DIR = legacyConfigDir;

	// Act: first read should trigger migration into getAppDataPath() directory
	const data = readUsageData();

	// Assert: data is preserved
	t.is(data.totalLifetime, 123);
	t.is(data.sessions.length, 1);

	// And the new file exists at the app data path
	const appDataHome = process.env.XDG_DATA_HOME!;
	const appDataDir = path.join(appDataHome, 'nanocoder');
	const newFilePath = path.join(appDataDir, 'usage.json');
	t.true(fs.existsSync(newFilePath));
});

test('migration removes legacy file after successful migration', t => {
	// Create legacy file
	const legacyConfigDir = path.join(os.tmpdir(), 'nanocoder-legacy-config-2');
	fs.mkdirSync(legacyConfigDir, {recursive: true});
	const legacyFilePath = path.join(legacyConfigDir, 'usage.json');
	const legacyData: UsageData = {
		sessions: [createMockSession('legacy', 'model', 456)],
		dailyAggregates: [],
		totalLifetime: 456,
		lastUpdated: Date.now(),
	};
	fs.writeFileSync(legacyFilePath, JSON.stringify(legacyData), 'utf-8');

	process.env.NANOCODER_CONFIG_DIR = legacyConfigDir;

	// Trigger migration
	readUsageData();

	// Legacy file should be gone
	t.false(fs.existsSync(legacyFilePath));
});

test('migration skips when new file already exists', t => {
	// Create both legacy and new files
	const legacyConfigDir = path.join(os.tmpdir(), 'nanocoder-legacy-config-3');
	fs.mkdirSync(legacyConfigDir, {recursive: true});
	const legacyFilePath = path.join(legacyConfigDir, 'usage.json');
	const legacyData: UsageData = {
		sessions: [createMockSession('legacy', 'model', 111)],
		dailyAggregates: [],
		totalLifetime: 111,
		lastUpdated: Date.now(),
	};
	fs.writeFileSync(legacyFilePath, JSON.stringify(legacyData), 'utf-8');

	// Create new file with different data
	const appDataHome = process.env.XDG_DATA_HOME!;
	const appDataDir = path.join(appDataHome, 'nanocoder');
	fs.mkdirSync(appDataDir, {recursive: true});
	const newFilePath = path.join(appDataDir, 'usage.json');
	const newData: UsageData = {
		sessions: [createMockSession('new', 'model', 999)],
		dailyAggregates: [],
		totalLifetime: 999,
		lastUpdated: Date.now(),
	};
	fs.writeFileSync(newFilePath, JSON.stringify(newData), 'utf-8');

	process.env.NANOCODER_CONFIG_DIR = legacyConfigDir;

	// Read should use new file, not migrate
	const data = readUsageData();

	// Should have data from new file, not legacy
	t.is(data.totalLifetime, 999);

	// Legacy file should still exist (wasn't touched)
	t.true(fs.existsSync(legacyFilePath));
	t.true(fs.existsSync(newFilePath));
});

test('migration handles missing legacy config directory gracefully', t => {
	// Don't create legacy directory, just set NANOCODER_CONFIG_DIR to non-existent path
	process.env.NANOCODER_CONFIG_DIR = path.join(
		os.tmpdir(),
		'nanocoder-nonexistent',
	);

	// Should not throw and should return empty data
	const data = readUsageData();
	t.is(data.sessions.length, 0);
	t.is(data.totalLifetime, 0);
});

test('migration handles corrupt legacy file gracefully', t => {
	// Create legacy file with invalid JSON
	const legacyConfigDir = path.join(os.tmpdir(), 'nanocoder-legacy-config-4');
	fs.mkdirSync(legacyConfigDir, {recursive: true});
	const legacyFilePath = path.join(legacyConfigDir, 'usage.json');
	fs.writeFileSync(legacyFilePath, 'not valid json{{{', 'utf-8');

	process.env.NANOCODER_CONFIG_DIR = legacyConfigDir;

	// Should not throw, should return empty data
	const data = readUsageData();
	t.is(data.sessions.length, 0);
	t.is(data.totalLifetime, 0);
});

test('migration preserves all session data fields', t => {
	const legacyConfigDir = path.join(os.tmpdir(), 'nanocoder-legacy-config-5');
	fs.mkdirSync(legacyConfigDir, {recursive: true});
	const legacyFilePath = path.join(legacyConfigDir, 'usage.json');

	// Create a session with all fields
	const session = createMockSession('test-provider', 'test-model', 5000);
	const legacyData: UsageData = {
		sessions: [session],
		dailyAggregates: [
			{
				date: '2025-01-01',
				sessions: 1,
				totalTokens: 5000,
				providers: {'test-provider': 5000},
				models: {'test-model': 5000},
			},
		],
		totalLifetime: 5000,
		lastUpdated: Date.now(),
	};
	fs.writeFileSync(legacyFilePath, JSON.stringify(legacyData), 'utf-8');

	process.env.NANOCODER_CONFIG_DIR = legacyConfigDir;

	const data = readUsageData();

	// Verify all fields preserved
	t.is(data.sessions.length, 1);
	t.is(data.sessions[0]!.provider, 'test-provider');
	t.is(data.sessions[0]!.model, 'test-model');
	t.is(data.sessions[0]!.tokens.total, 5000);
	t.is(data.dailyAggregates.length, 1);
	t.is(data.dailyAggregates[0]!.providers['test-provider'], 5000);
	t.is(data.totalLifetime, 5000);
});

// Helper to create mock token breakdown
function createMockBreakdown(total = 1000): TokenBreakdown {
	return {
		system: Math.floor(total * 0.3),
		userMessages: Math.floor(total * 0.2),
		assistantMessages: Math.floor(total * 0.3),
		toolResults: Math.floor(total * 0.1),
		toolDefinitions: Math.floor(total * 0.1),
		total,
	};
}

// Helper to create mock session
function createMockSession(
	provider = 'test-provider',
	model = 'test-model',
	tokens = 1000,
): SessionUsage {
	return {
		id: `session-${Date.now()}`,
		timestamp: Date.now(),
		provider,
		model,
		tokens: createMockBreakdown(tokens),
		messageCount: 10,
		duration: 60000,
	};
}

// ============================================================================
// readUsageData Tests
// ============================================================================

test('readUsageData returns empty data when file does not exist', t => {
	const data = readUsageData();

	t.is(data.sessions.length, 0);
	t.is(data.dailyAggregates.length, 0);
	t.is(data.totalLifetime, 0);
	t.truthy(data.lastUpdated);
});

test('readUsageData returns empty data on read error', t => {
	// Write invalid JSON
	const dataHome =
		process.env.XDG_DATA_HOME || path.join(os.tmpdir(), 'test-data');
	const configDir = path.join(dataHome, 'nanocoder');
	fs.mkdirSync(configDir, {recursive: true});
	fs.writeFileSync(path.join(configDir, 'usage.json'), 'invalid json', 'utf-8');

	const data = readUsageData();

	t.is(data.sessions.length, 0);
	t.is(data.dailyAggregates.length, 0);
	t.is(data.totalLifetime, 0);
});

test('readUsageData reads existing data', t => {
	// Write valid data first
	const mockData: UsageData = {
		sessions: [createMockSession()],
		dailyAggregates: [],
		totalLifetime: 1000,
		lastUpdated: Date.now(),
	};

	writeUsageData(mockData);

	const data = readUsageData();

	t.is(data.sessions.length, 1);
	t.is(data.totalLifetime, 1000);
});

// ============================================================================
// writeUsageData Tests
// ============================================================================

test('writeUsageData creates and writes data successfully', t => {
	const mockData: UsageData = {
		sessions: [createMockSession()],
		dailyAggregates: [],
		totalLifetime: 1000,
		lastUpdated: Date.now(),
	};

	// Write data
	writeUsageData(mockData);

	// Read it back
	const data = readUsageData();
	t.is(data.sessions.length, 1);
	t.is(data.totalLifetime, 1000);
});

test('writeUsageData writes data to file', t => {
	const mockData: UsageData = {
		sessions: [createMockSession()],
		dailyAggregates: [],
		totalLifetime: 1000,
		lastUpdated: Date.now(),
	};

	writeUsageData(mockData);

	const data = readUsageData();
	t.is(data.sessions.length, 1);
	t.is(data.totalLifetime, 1000);
});

test('writeUsageData updates lastUpdated timestamp', t => {
	const oldTimestamp = Date.now() - 10000;
	const mockData: UsageData = {
		sessions: [],
		dailyAggregates: [],
		totalLifetime: 0,
		lastUpdated: oldTimestamp,
	};

	writeUsageData(mockData);

	const data = readUsageData();
	t.true(data.lastUpdated > oldTimestamp);
});

test('writeUsageData handles write errors gracefully', t => {
	const dataHome =
		process.env.XDG_DATA_HOME || path.join(os.tmpdir(), 'test-data');
	const configDir = path.join(dataHome, 'nanocoder');

	// Make directory if needed, then make it read-only
	fs.mkdirSync(configDir, {recursive: true});
	fs.chmodSync(configDir, 0o444);

	const mockData: UsageData = {
		sessions: [],
		dailyAggregates: [],
		totalLifetime: 0,
		lastUpdated: Date.now(),
	};

	// Should not throw
	t.notThrows(() => writeUsageData(mockData));

	// Restore permissions for cleanup
	fs.chmodSync(configDir, 0o755);
});

// ============================================================================
// addSession Tests
// ============================================================================

test('addSession adds new session to empty data', t => {
	const session = createMockSession();

	addSession(session);

	const data = readUsageData();
	t.is(data.sessions.length, 1);
	t.is(data.sessions[0]!.id, session.id);
	t.is(data.totalLifetime, session.tokens.total);
});

test('addSession adds session to beginning of list', t => {
	const session1 = createMockSession('provider1', 'model1', 1000);
	const session2 = createMockSession('provider2', 'model2', 2000);

	addSession(session1);
	addSession(session2);

	const data = readUsageData();
	t.is(data.sessions.length, 2);
	t.is(data.sessions[0]!.id, session2.id); // Most recent first
	t.is(data.sessions[1]!.id, session1.id);
});

test('addSession updates total lifetime tokens', t => {
	const session1 = createMockSession('provider1', 'model1', 1000);
	const session2 = createMockSession('provider2', 'model2', 2000);

	addSession(session1);
	addSession(session2);

	const data = readUsageData();
	t.is(data.totalLifetime, 3000);
});

test('addSession limits sessions to MAX_SESSIONS (100)', t => {
	// Add 101 sessions
	for (let i = 0; i < 101; i++) {
		const session = createMockSession(`provider-${i}`, `model-${i}`, 100);
		addSession(session);
	}

	const data = readUsageData();
	t.is(data.sessions.length, 100); // Should be limited to 100
});

test('addSession creates daily aggregate', t => {
	const session = createMockSession();

	addSession(session);

	const data = readUsageData();
	t.is(data.dailyAggregates.length, 1);

	const today = new Date().toISOString().split('T')[0];
	const aggregate = data.dailyAggregates.find(agg => agg.date === today);

	t.truthy(aggregate);
	t.is(aggregate!.sessions, 1);
	t.is(aggregate!.totalTokens, session.tokens.total);
});

test('addSession updates existing daily aggregate', t => {
	const session1 = createMockSession('provider1', 'model1', 1000);
	const session2 = createMockSession('provider2', 'model2', 2000);

	addSession(session1);
	addSession(session2);

	const data = readUsageData();
	const today = new Date().toISOString().split('T')[0];
	const aggregate = data.dailyAggregates.find(agg => agg.date === today);

	t.truthy(aggregate);
	t.is(aggregate!.sessions, 2);
	t.is(aggregate!.totalTokens, 3000);
});

test('addSession tracks provider stats in daily aggregate', t => {
	const session1 = createMockSession('openai', 'gpt-4', 1000);
	const session2 = createMockSession('openai', 'gpt-3.5', 2000);
	const session3 = createMockSession('anthropic', 'claude', 3000);

	addSession(session1);
	addSession(session2);
	addSession(session3);

	const data = readUsageData();
	const today = new Date().toISOString().split('T')[0];
	const aggregate = data.dailyAggregates.find(agg => agg.date === today);

	t.truthy(aggregate);
	t.is(aggregate!.providers.openai, 3000); // 1000 + 2000
	t.is(aggregate!.providers.anthropic, 3000);
});

test('addSession tracks model stats in daily aggregate', t => {
	const session1 = createMockSession('openai', 'gpt-4', 1000);
	const session2 = createMockSession('openai', 'gpt-4', 2000);
	const session3 = createMockSession('openai', 'gpt-3.5', 3000);

	addSession(session1);
	addSession(session2);
	addSession(session3);

	const data = readUsageData();
	const today = new Date().toISOString().split('T')[0];
	const aggregate = data.dailyAggregates.find(agg => agg.date === today);

	t.truthy(aggregate);
	t.is(aggregate!.models['gpt-4'], 3000); // 1000 + 2000
	t.is(aggregate!.models['gpt-3.5'], 3000);
});

test('addSession limits daily aggregates to MAX_DAILY_AGGREGATES (30)', t => {
	// Create sessions with different dates
	for (let i = 0; i < 35; i++) {
		const session = createMockSession();
		// Modify timestamp to be i days ago
		session.timestamp = Date.now() - i * 24 * 60 * 60 * 1000;
		addSession(session);
	}

	const data = readUsageData();
	t.is(data.dailyAggregates.length, 30); // Should be limited to 30
});

// ============================================================================
// getTodayAggregate Tests
// ============================================================================

test('getTodayAggregate returns null when no data exists', t => {
	const aggregate = getTodayAggregate();
	t.is(aggregate, null);
});

test('getTodayAggregate returns null when no sessions today', t => {
	// Add a session from yesterday
	const session = createMockSession();
	session.timestamp = Date.now() - 24 * 60 * 60 * 1000;
	addSession(session);

	const aggregate = getTodayAggregate();
	t.is(aggregate, null);
});

test('getTodayAggregate returns today aggregate', t => {
	const session = createMockSession('openai', 'gpt-4', 1000);
	addSession(session);

	const aggregate = getTodayAggregate();

	t.truthy(aggregate);
	t.is(aggregate!.sessions, 1);
	t.is(aggregate!.totalTokens, 1000);
	t.is(aggregate!.date, new Date().toISOString().split('T')[0]);
});

// ============================================================================
// getLastNDaysAggregate Tests
// ============================================================================

test('getLastNDaysAggregate returns zero when no data exists', t => {
	const result = getLastNDaysAggregate(7);

	t.is(result.totalTokens, 0);
	t.is(result.totalSessions, 0);
	t.is(result.avgTokensPerDay, 0);
});

test('getLastNDaysAggregate calculates totals for last 7 days', t => {
	// Add sessions for the past 5 days
	for (let i = 0; i < 5; i++) {
		const session = createMockSession('openai', 'gpt-4', 1000);
		session.timestamp = Date.now() - i * 24 * 60 * 60 * 1000;
		addSession(session);
	}

	const result = getLastNDaysAggregate(7);

	t.is(result.totalTokens, 5000);
	t.is(result.totalSessions, 5);
	t.is(result.avgTokensPerDay, Math.round(5000 / 7));
});

test('getLastNDaysAggregate filters out older sessions', t => {
	// Add 3 sessions within last 7 days
	for (let i = 0; i < 3; i++) {
		const session = createMockSession('openai', 'gpt-4', 1000);
		session.timestamp = Date.now() - i * 24 * 60 * 60 * 1000;
		addSession(session);
	}

	// Add 2 sessions older than 7 days
	for (let i = 8; i < 10; i++) {
		const session = createMockSession('openai', 'gpt-4', 1000);
		session.timestamp = Date.now() - i * 24 * 60 * 60 * 1000;
		addSession(session);
	}

	const result = getLastNDaysAggregate(7);

	// Should only count the 3 recent sessions
	t.is(result.totalTokens, 3000);
	t.is(result.totalSessions, 3);
});

test('getLastNDaysAggregate handles different day ranges', t => {
	// Add sessions for the past 10 days
	for (let i = 0; i < 10; i++) {
		const session = createMockSession('openai', 'gpt-4', 1000);
		session.timestamp = Date.now() - i * 24 * 60 * 60 * 1000;
		addSession(session);
	}

	const result7 = getLastNDaysAggregate(7);
	const result30 = getLastNDaysAggregate(30);

	// 7 days should include days 0-6 (7 sessions)
	// But depending on timing, might include day 7 too if timestamps align
	t.true(result7.totalTokens >= 7000 && result7.totalTokens <= 8000);
	t.is(result30.totalTokens, 10000);
});

test('getLastNDaysAggregate calculates average correctly', t => {
	// Add 10 sessions over 5 days
	for (let i = 0; i < 10; i++) {
		const session = createMockSession('openai', 'gpt-4', 500);
		session.timestamp = Date.now() - (i % 5) * 24 * 60 * 60 * 1000;
		addSession(session);
	}

	const result = getLastNDaysAggregate(7);

	// 10 sessions * 500 tokens = 5000 total
	// Average over 7 days = 5000 / 7 ≈ 714
	t.is(result.totalTokens, 5000);
	t.is(result.avgTokensPerDay, Math.round(5000 / 7));
});

// ============================================================================
// clearUsageData Tests
// ============================================================================

test('clearUsageData removes usage file', t => {
	// Add some data first
	const session = createMockSession();
	addSession(session);

	// Verify data exists
	let data = readUsageData();
	t.is(data.sessions.length, 1);

	// Clear data
	clearUsageData();

	// Verify data is empty
	data = readUsageData();
	t.is(data.sessions.length, 0);
	t.is(data.totalLifetime, 0);
});

test('clearUsageData handles non-existent file', t => {
	// Should not throw even if file doesn't exist
	t.notThrows(() => clearUsageData());
});

test('clearUsageData is idempotent', t => {
	// Add and clear data
	addSession(createMockSession());
	clearUsageData();

	// Clear again
	t.notThrows(() => clearUsageData());

	// Verify still empty
	const data = readUsageData();
	t.is(data.sessions.length, 0);
});

// ============================================================================
// Integration Tests
// ============================================================================

test('complete usage tracking flow', t => {
	// Start with empty data
	let data = readUsageData();
	t.is(data.sessions.length, 0);

	// Add multiple sessions
	const session1 = createMockSession('openai', 'gpt-4', 1000);
	const session2 = createMockSession('anthropic', 'claude', 2000);
	const session3 = createMockSession('openai', 'gpt-3.5', 1500);

	addSession(session1);
	addSession(session2);
	addSession(session3);

	// Verify sessions added
	data = readUsageData();
	t.is(data.sessions.length, 3);
	t.is(data.totalLifetime, 4500);

	// Verify daily aggregate
	const today = new Date().toISOString().split('T')[0];
	const aggregate = data.dailyAggregates.find(agg => agg.date === today);
	t.truthy(aggregate);
	t.is(aggregate!.sessions, 3);
	t.is(aggregate!.totalTokens, 4500);

	// Verify getTodayAggregate
	const todayAgg = getTodayAggregate();
	t.is(todayAgg!.totalTokens, 4500);

	// Verify getLastNDaysAggregate
	const weekStats = getLastNDaysAggregate(7);
	t.is(weekStats.totalTokens, 4500);
	t.is(weekStats.totalSessions, 3);

	// Clear and verify
	clearUsageData();
	data = readUsageData();
	t.is(data.sessions.length, 0);
});
