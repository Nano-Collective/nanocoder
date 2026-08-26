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
	STATS_SHUTDOWN_HANDLER_NAME,
} from './record';
import {
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
import {makePairKey} from './types';

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
	t.is(loaded.daily[0]?.byPair[makePairKey('OpenRouter', 'gpt-5')]?.tokens, 1500);
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

test('subagent executor records via recordApiCallForStats (priced path)', async t => {
	const src = await fs.promises.readFile(
		new URL('../subagents/subagent-executor.ts', import.meta.url),
		'utf8',
	);
	t.regex(src, /recordApiCallForStats/);
	t.regex(src, /totalTokens:\s*finalTokenCount/);
	t.false(/recordTokenUsage\(\s*\{/.test(src));
});
