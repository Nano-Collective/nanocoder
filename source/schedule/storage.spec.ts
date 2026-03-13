import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {
	addScheduleRun,
	generateScheduleId,
	loadScheduleRuns,
	loadSchedules,
	saveScheduleRuns,
	saveSchedules,
	updateScheduleRun,
} from './storage';
import type {Schedule, ScheduleRun} from './types';

// Use a temp directory so tests don't interfere with real data
const originalCwd = process.cwd;
const testDir = join(process.cwd(), '.test-schedule-storage');

function setupTestDir() {
	if (existsSync(testDir)) {
		rmSync(testDir, {recursive: true});
	}
	mkdirSync(testDir, {recursive: true});
	// Override cwd for storage functions
	process.cwd = () => testDir;
}

function cleanupTestDir() {
	process.cwd = originalCwd;
	if (existsSync(testDir)) {
		rmSync(testDir, {recursive: true});
	}
}

const makeSchedule = (overrides?: Partial<Schedule>): Schedule => ({
	id: generateScheduleId(),
	cron: '0 9 * * *',
	command: 'test.md',
	enabled: true,
	createdAt: new Date().toISOString(),
	lastRunAt: null,
	...overrides,
});

const makeRun = (overrides?: Partial<ScheduleRun>): ScheduleRun => ({
	id: `run-${generateScheduleId()}`,
	scheduleId: 'sched-1',
	command: 'test.md',
	startedAt: new Date().toISOString(),
	completedAt: null,
	status: 'running',
	...overrides,
});

// ============================================================================
// generateScheduleId Tests
// ============================================================================

test('generateScheduleId returns an 8-character string', t => {
	const id = generateScheduleId();
	t.is(typeof id, 'string');
	t.is(id.length, 8);
});

test('generateScheduleId returns unique values', t => {
	const ids = new Set(Array.from({length: 50}, () => generateScheduleId()));
	t.is(ids.size, 50);
});

// ============================================================================
// loadSchedules / saveSchedules Tests
// ============================================================================

test.serial('loadSchedules returns empty array when no file exists', async t => {
	setupTestDir();
	try {
		const schedules = await loadSchedules();
		t.deepEqual(schedules, []);
	} finally {
		cleanupTestDir();
	}
});

test.serial('saveSchedules and loadSchedules round-trip correctly', async t => {
	setupTestDir();
	try {
		const schedule = makeSchedule({id: 'test-1'});
		await saveSchedules([schedule]);
		const loaded = await loadSchedules();
		t.is(loaded.length, 1);
		t.is(loaded[0]?.id, 'test-1');
		t.is(loaded[0]?.cron, schedule.cron);
		t.is(loaded[0]?.command, schedule.command);
	} finally {
		cleanupTestDir();
	}
});

test.serial('saveSchedules creates directory if missing', async t => {
	setupTestDir();
	try {
		const nanocoderDir = join(testDir, '.nanocoder');
		t.false(existsSync(nanocoderDir));
		await saveSchedules([makeSchedule()]);
		t.true(existsSync(nanocoderDir));
	} finally {
		cleanupTestDir();
	}
});

test.serial('saveSchedules overwrites existing data', async t => {
	setupTestDir();
	try {
		await saveSchedules([makeSchedule({id: 'first'})]);
		await saveSchedules([makeSchedule({id: 'second'})]);
		const loaded = await loadSchedules();
		t.is(loaded.length, 1);
		t.is(loaded[0]?.id, 'second');
	} finally {
		cleanupTestDir();
	}
});

test.serial('loadSchedules handles malformed JSON gracefully', async t => {
	setupTestDir();
	try {
		const dir = join(testDir, '.nanocoder');
		mkdirSync(dir, {recursive: true});
		writeFileSync(join(dir, 'schedules.json'), 'not json', 'utf-8');
		const schedules = await loadSchedules();
		t.deepEqual(schedules, []);
	} finally {
		cleanupTestDir();
	}
});

// ============================================================================
// loadScheduleRuns / saveScheduleRuns Tests
// ============================================================================

test.serial('loadScheduleRuns returns empty array when no file exists', async t => {
	setupTestDir();
	try {
		const runs = await loadScheduleRuns();
		t.deepEqual(runs, []);
	} finally {
		cleanupTestDir();
	}
});

test.serial('saveScheduleRuns and loadScheduleRuns round-trip correctly', async t => {
	setupTestDir();
	try {
		const run = makeRun({id: 'run-test-1'});
		await saveScheduleRuns([run]);
		const loaded = await loadScheduleRuns();
		t.is(loaded.length, 1);
		t.is(loaded[0]?.id, 'run-test-1');
	} finally {
		cleanupTestDir();
	}
});

test.serial('saveScheduleRuns caps at 100 entries', async t => {
	setupTestDir();
	try {
		const runs = Array.from({length: 120}, (_, i) =>
			makeRun({id: `run-${i}`}),
		);
		await saveScheduleRuns(runs);
		const loaded = await loadScheduleRuns();
		t.is(loaded.length, 100);
		// Should keep the last 100 (indices 20-119)
		t.is(loaded[0]?.id, 'run-20');
		t.is(loaded[99]?.id, 'run-119');
	} finally {
		cleanupTestDir();
	}
});

// ============================================================================
// addScheduleRun Tests
// ============================================================================

test.serial('addScheduleRun appends a run', async t => {
	setupTestDir();
	try {
		await addScheduleRun(makeRun({id: 'run-a'}));
		await addScheduleRun(makeRun({id: 'run-b'}));
		const loaded = await loadScheduleRuns();
		t.is(loaded.length, 2);
		t.is(loaded[0]?.id, 'run-a');
		t.is(loaded[1]?.id, 'run-b');
	} finally {
		cleanupTestDir();
	}
});

// ============================================================================
// updateScheduleRun Tests
// ============================================================================

test.serial('updateScheduleRun updates an existing run', async t => {
	setupTestDir();
	try {
		await addScheduleRun(makeRun({id: 'run-update', status: 'running'}));
		await updateScheduleRun('run-update', {
			status: 'success',
			completedAt: '2025-01-01T00:00:00Z',
		});
		const loaded = await loadScheduleRuns();
		t.is(loaded[0]?.status, 'success');
		t.is(loaded[0]?.completedAt, '2025-01-01T00:00:00Z');
	} finally {
		cleanupTestDir();
	}
});

test.serial('updateScheduleRun does nothing for non-existent run', async t => {
	setupTestDir();
	try {
		await addScheduleRun(makeRun({id: 'run-exists'}));
		await updateScheduleRun('run-nonexistent', {status: 'error'});
		const loaded = await loadScheduleRuns();
		t.is(loaded.length, 1);
		t.is(loaded[0]?.id, 'run-exists');
		t.is(loaded[0]?.status, 'running');
	} finally {
		cleanupTestDir();
	}
});

test.serial('updateScheduleRun can set error field', async t => {
	setupTestDir();
	try {
		await addScheduleRun(makeRun({id: 'run-err'}));
		await updateScheduleRun('run-err', {
			status: 'error',
			error: 'Something went wrong',
		});
		const loaded = await loadScheduleRuns();
		t.is(loaded[0]?.status, 'error');
		t.is(loaded[0]?.error, 'Something went wrong');
	} finally {
		cleanupTestDir();
	}
});
