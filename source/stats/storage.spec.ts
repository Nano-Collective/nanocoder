import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'ava';
import {
	_cancelPendingFlushForTests,
	_resetStatsRecorderForTests,
	ensureStatsFlushOnShutdown,
	finalizeStatsForExit,
	flushStatsLedgerSync,
	recordSessionCreated,
	recordTokenUsage,
	recordUserPrompt,
	resetStatsLedger,
	STATS_SHUTDOWN_HANDLER_NAME,
} from './record';
import {
	LEGACY_STATS_FILE_NAME,
	STATS_FILE_NAME,
	applyPromptIncrement,
	applySessionIncrement,
	applyTokenIncrement,
	clearStatsLedger,
	createEmptyLedger,
	getStatsFilePath,
	readStatsLedger,
	writeStatsLedger,
} from './storage';
import {STATS_LEDGER_VERSION, makePairKey} from './types';

console.log('\nstats/storage.spec.ts');

function createTestDir(): string {
	const testDir = path.join(
		os.tmpdir(),
		`nanocoder-stats-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	fs.mkdirSync(testDir, {recursive: true});
	return testDir;
}

let originalEnv: NodeJS.ProcessEnv;

test.before(() => {
	originalEnv = {...process.env};
});

test.beforeEach(() => {
	_resetStatsRecorderForTests();
	const testDir = createTestDir();
	process.env.XDG_DATA_HOME = testDir;
	delete process.env.NANOCODER_DATA_DIR;
	clearStatsLedger();
});

test.afterEach(() => {
	_resetStatsRecorderForTests();
	flushStatsLedgerSync();
	clearStatsLedger();
	try {
		if (process.env.XDG_DATA_HOME) {
			fs.rmSync(process.env.XDG_DATA_HOME, {recursive: true, force: true});
		}
	} catch {
		// ignore
	}
});

test.after(() => {
	process.env = originalEnv;
});

test('readStatsLedger returns empty when missing', t => {
	const ledger = readStatsLedger();
	t.is(ledger.totalSessions, 0);
	t.is(ledger.totalPrompts, 0);
	t.is(ledger.totalTokens, 0);
	t.deepEqual(ledger.daily, []);
	t.deepEqual(ledger.monthly, []);
});

test('write + read round-trip', t => {
	const ledger = createEmptyLedger(1_700_000_000_000);
	applySessionIncrement(ledger, '2026-08-25');
	applyPromptIncrement(ledger, 'OpenRouter', 'gpt-5', '2026-08-25');
	applyTokenIncrement(ledger, 'OpenRouter', 'gpt-5', 1500, 0.02, '2026-08-25');
	writeStatsLedger(ledger);

	t.true(fs.existsSync(getStatsFilePath()));
	t.true(getStatsFilePath().endsWith(STATS_FILE_NAME));

	const loaded = readStatsLedger();
	t.is(loaded.totalSessions, 1);
	t.is(loaded.totalPrompts, 1);
	t.is(loaded.totalTokens, 1500);
	t.is(loaded.totalCost, 0.02);
	t.is(loaded.daily.length, 1);
	t.is(loaded.monthly.length, 1);
	t.is(loaded.monthly[0]?.tokens, 1500);
	t.is(loaded.daily[0]?.byPair[makePairKey('OpenRouter', 'gpt-5')]?.tokens, 1500);
});

test('migrates the legacy filename and v1 ledger schema', t => {
	const canonicalPath = getStatsFilePath();
	const legacyPath = path.join(path.dirname(canonicalPath), LEGACY_STATS_FILE_NAME);
	fs.mkdirSync(path.dirname(legacyPath), {recursive: true});
	fs.writeFileSync(
		legacyPath,
		JSON.stringify({
			version: 1,
			createdAt: 1_700_000_000_000,
			totalSessions: 1,
			totalPrompts: 1,
			totalTokens: 1500,
			totalCost: 0.02,
			daily: [
				{
					date: '2026-08-25',
					sessions: 1,
					prompts: 1,
					tokens: 1500,
					cost: 0.02,
					byPair: {
						[makePairKey('OpenRouter', 'gpt-5')]: {
							tokens: 1500,
							prompts: 1,
							cost: 0.02,
						},
					},
				},
			],
			lastUpdated: 1_700_000_000_000,
		}),
		'utf8',
	);

	const loaded = readStatsLedger();

	t.is(loaded.version, STATS_LEDGER_VERSION);
	t.is(loaded.totalTokens, 1500);
	t.is(loaded.monthly[0]?.month, '2026-08');
	t.is(loaded.monthly[0]?.tokens, 1500);
	t.true(fs.existsSync(canonicalPath));
	t.false(fs.existsSync(legacyPath));
	const migrated = JSON.parse(fs.readFileSync(canonicalPath, 'utf8')) as {
		version: number;
		monthly?: unknown[];
	};
	t.is(migrated.version, STATS_LEDGER_VERSION);
	t.true(Array.isArray(migrated.monthly));
});

test('migrates a v1 ledger in the canonical filename', t => {
	const canonicalPath = getStatsFilePath();
	fs.mkdirSync(path.dirname(canonicalPath), {recursive: true});
	fs.writeFileSync(
		canonicalPath,
		JSON.stringify({
			version: 1,
			createdAt: 1_700_000_000_000,
			totalTokens: 25,
			daily: [
				{
					date: '2026-08-25',
					tokens: 25,
					byPair: {},
				},
			],
		}),
		'utf8',
	);

	const loaded = readStatsLedger();
	const migrated = JSON.parse(fs.readFileSync(canonicalPath, 'utf8')) as {
		version: number;
		monthly?: unknown[];
	};

	t.is(loaded.totalTokens, 25);
	t.is(migrated.version, STATS_LEDGER_VERSION);
	t.true(Array.isArray(migrated.monthly));
});

test('drops invalid calendar dates during migration', t => {
	const canonicalPath = getStatsFilePath();
	fs.mkdirSync(path.dirname(canonicalPath), {recursive: true});
	fs.writeFileSync(
		canonicalPath,
		JSON.stringify({
			version: 1,
			createdAt: 1_700_000_000_000,
			totalTokens: 25,
			daily: [
				{date: '2026-02-30', tokens: 100},
				{date: '2026-02-28', tokens: 25},
			],
		}),
		'utf8',
	);

	const loaded = readStatsLedger();

	t.deepEqual(loaded.daily.map(day => day.date), ['2026-02-28']);
	t.is(loaded.monthly[0]?.tokens, 25);
});

test('canonical stats file wins over the legacy filename', t => {
	const canonicalPath = getStatsFilePath();
	const legacyPath = path.join(path.dirname(canonicalPath), LEGACY_STATS_FILE_NAME);
	const canonical = createEmptyLedger(1_700_000_000_000);
	applyTokenIncrement(canonical, 'OpenRouter', 'gpt-5', 100, 0, '2026-08-25');
	writeStatsLedger(canonical);

	const legacy = createEmptyLedger(1_700_000_000_000);
	applyTokenIncrement(legacy, 'Ollama', 'qwen', 200, 0, '2026-08-25');
	fs.writeFileSync(legacyPath, JSON.stringify(legacy), 'utf8');

	const loaded = readStatsLedger();
	t.is(loaded.totalTokens, 100);
	t.true(fs.existsSync(legacyPath));
});

test('unsupported ledger versions are rejected without throwing', t => {
	const filePath = getStatsFilePath();
	fs.mkdirSync(path.dirname(filePath), {recursive: true});
	fs.writeFileSync(filePath, JSON.stringify({version: 999}), 'utf8');

	const loaded = readStatsLedger();
	t.is(loaded.version, STATS_LEDGER_VERSION);
	t.is(loaded.totalTokens, 0);
	t.true(fs.existsSync(filePath));
});

test('applyTokenIncrement ignores non-positive tokens but prompt still counts', t => {
	const ledger = createEmptyLedger();
	applyPromptIncrement(ledger, 'Ollama', 'qwen', '2026-08-25');
	applyTokenIncrement(ledger, 'Ollama', 'qwen', 0, 0, '2026-08-25');
	applyTokenIncrement(ledger, 'Ollama', 'qwen', Number.NaN, 0, '2026-08-25');
	t.is(ledger.totalPrompts, 1);
	t.is(ledger.totalTokens, 0);
});

test('one provider three models accumulate separately', t => {
	const ledger = createEmptyLedger();
	applyTokenIncrement(ledger, 'OpenRouter', 'gpt-5', 550, 0, '2026-08-25');
	applyTokenIncrement(ledger, 'OpenRouter', 'claude-sonnet', 300, 0, '2026-08-25');
	applyTokenIncrement(ledger, 'OpenRouter', 'deepseek-r1', 150, 0, '2026-08-25');
	t.is(ledger.totalTokens, 1000);
	const pairs = Object.keys(ledger.daily[0]?.byPair ?? {});
	t.is(pairs.length, 3);
});

test('record* APIs flush to disk after debounce flush', t => {
	recordSessionCreated('2026-08-25');
	recordUserPrompt('OpenRouter', 'gpt-5', '2026-08-25');
	recordTokenUsage({
		provider: 'OpenRouter',
		model: 'gpt-5',
		tokens: 42,
		cost: 0.01,
		dateKey: '2026-08-25',
	});
	flushStatsLedgerSync();

	_resetStatsRecorderForTests();
	const loaded = readStatsLedger();
	t.is(loaded.totalSessions, 1);
	t.is(loaded.totalPrompts, 1);
	t.is(loaded.totalTokens, 42);
});

test('recordApiCallForStats stores cost > 0 via production pricing path', async t => {
	const {recordApiCallForStats} = await import('./record.js');
	await recordApiCallForStats(
		{
			provider: 'OpenRouter',
			model: 'gpt-5',
			inputTokens: 1_000_000,
			outputTokens: 500_000,
			totalTokens: 1_500_000,
		},
		{
			dateKey: '2026-08-25',
			// $1 / $2 per million tokens → cost = 1*1 + 2*0.5 = $2
			getPricing: async () => ({input: 1, output: 2}),
		},
	);
	flushStatsLedgerSync();
	_resetStatsRecorderForTests();
	const loaded = readStatsLedger();
	t.is(loaded.totalTokens, 1_500_000);
	t.true(loaded.totalCost > 0);
	t.is(loaded.totalCost, 2);
});

test('recordApiCallForStats prices cached input at cache rates', async t => {
	const {recordApiCallForStats} = await import('./record.js');
	await recordApiCallForStats(
		{
			provider: 'OpenRouter',
			model: 'gpt-5',
			inputTokens: 1_000_000,
			outputTokens: 100_000,
			totalTokens: 1_100_000,
			cacheReadTokens: 500_000,
			cacheWriteTokens: 100_000,
		},
		{
			dateKey: '2026-08-25',
			getPricing: async () => ({
				input: 3,
				output: 15,
				cache_read: 0.3,
				cache_write: 0.6,
			}),
		},
	);
	flushStatsLedgerSync();

	const loaded = readStatsLedger();
	// 400k uncached input * $3 + 500k read * $0.30 +
	// 100k write * $0.60 + 100k output * $15 = $2.91.
	t.is(loaded.totalTokens, 1_100_000);
	t.is(loaded.totalCost, 2.91);
});

test('finalizeStatsForExit persists dirty ledger when debounce is cancelled', t => {
	const filePath = getStatsFilePath();
	recordTokenUsage({
		provider: 'OpenRouter',
		model: 'gpt-5',
		tokens: 777,
		dateKey: '2026-08-25',
	});
	// Simulate process exit before the unref'd 400ms timer fires.
	_cancelPendingFlushForTests();
	t.false(fs.existsSync(filePath));

	finalizeStatsForExit();

	t.true(fs.existsSync(filePath));
	_resetStatsRecorderForTests();
	const loaded = readStatsLedger();
	t.is(loaded.totalTokens, 777);
});

test('ensureStatsFlushOnShutdown is idempotent and flush handler persists dirty data', async t => {
	ensureStatsFlushOnShutdown();
	t.notThrows(() => ensureStatsFlushOnShutdown());

	recordTokenUsage({
		provider: 'OpenRouter',
		model: 'gpt-5',
		tokens: 888,
		dateKey: '2026-08-25',
	});
	_cancelPendingFlushForTests();

	// Invoke the same work the ShutdownManager handler performs.
	finalizeStatsForExit();

	_resetStatsRecorderForTests();
	const loaded = readStatsLedger();
	t.is(loaded.totalTokens, 888);
	t.is(STATS_SHUTDOWN_HANDLER_NAME, 'stats-ledger-flush');
});

test('resetStatsLedger clears disk and the in-memory ledger', t => {
	recordTokenUsage({
		provider: 'OpenRouter',
		model: 'gpt-5',
		tokens: 888,
		dateKey: '2026-08-25',
	});
	flushStatsLedgerSync();
	t.true(fs.existsSync(getStatsFilePath()));

	resetStatsLedger();

	t.false(fs.existsSync(getStatsFilePath()));
	t.is(readStatsLedger().totalTokens, 0);
});

test('resetStatsLedger ignores in-flight usage writes from before the reset', async t => {
	let resolvePricing!: (value: {input: number; output: number}) => void;
	let markPricingStarted!: () => void;
	const pricingStarted = new Promise<void>(resolve => {
		markPricingStarted = resolve;
	});
	const pricing = new Promise<{input: number; output: number}>(resolve => {
		resolvePricing = resolve;
	});
	const {recordApiCallForStats} = await import('./record.js');
	const inFlight = recordApiCallForStats(
		{
			provider: 'OpenRouter',
			model: 'gpt-5',
			totalTokens: 100,
		},
		{
			getPricing: async () => {
				markPricingStarted();
				return pricing;
			},
		},
	);

	await pricingStarted;
	resetStatsLedger();
	resolvePricing({input: 1, output: 2});
	await inFlight;
	flushStatsLedgerSync();

	t.is(readStatsLedger().totalTokens, 0);
});

test('failed flush keeps pending so a later write still persists the first batch', t => {
	recordSessionCreated('2026-08-25');
	recordUserPrompt('OpenRouter', 'gpt-5', '2026-08-25');
	recordUserPrompt('OpenRouter', 'gpt-5', '2026-08-25');
	recordTokenUsage({
		provider: 'OpenRouter',
		model: 'gpt-5',
		tokens: 100,
		dateKey: '2026-08-25',
	});
	_cancelPendingFlushForTests();

	const parentDir = process.env.XDG_DATA_HOME;
	t.truthy(parentDir);
	const mode = fs.statSync(parentDir!).mode & 0o777;
	try {
		fs.chmodSync(parentDir!, 0o555);
		flushStatsLedgerSync();
		t.false(fs.existsSync(getStatsFilePath()));

		fs.chmodSync(parentDir!, mode);
		recordTokenUsage({
			provider: 'OpenRouter',
			model: 'gpt-5',
			tokens: 50,
			dateKey: '2026-08-25',
		});
		flushStatsLedgerSync();
	} finally {
		try {
			fs.chmodSync(parentDir!, mode);
		} catch {
			// ignore
		}
	}

	const loaded = readStatsLedger();
	t.is(loaded.totalSessions, 1);
	t.is(loaded.totalPrompts, 2);
	t.is(loaded.totalTokens, 150);
	t.is(
		loaded.daily[0]?.byPair[makePairKey('OpenRouter', 'gpt-5')]?.tokens,
		150,
	);
	t.is(
		loaded.daily[0]?.byPair[makePairKey('OpenRouter', 'gpt-5')]?.prompts,
		2,
	);
});

test('flush merges changes written by another session', t => {
	recordTokenUsage({
		provider: 'OpenRouter',
		model: 'gpt-5',
		tokens: 100,
		dateKey: '2026-08-25',
	});
	const otherSession = readStatsLedger();
	applyTokenIncrement(otherSession, 'Ollama', 'qwen', 200, 0, '2026-08-25');
	writeStatsLedger(otherSession);

	flushStatsLedgerSync();

	const loaded = readStatsLedger();
	t.is(loaded.totalTokens, 300);
	t.is(
		loaded.daily[0]?.byPair[makePairKey('OpenRouter', 'gpt-5')]?.tokens,
		100,
	);
	t.is(loaded.daily[0]?.byPair[makePairKey('Ollama', 'qwen')]?.tokens, 200);
});
