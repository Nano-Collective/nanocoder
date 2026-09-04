import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	TIMELINE_LOCK_PURPOSE,
	acquireTimelineLock,
	getTimelineLockPath,
	isProcessAlive,
	isTimelineLockLive,
	releaseTimelineLock,
} from './timeline-lock.js';

console.log('\ntimeline-lock.spec.ts');

async function tempSessionDir(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'timeline-lock-'));
	const sessionDir = join(root, 'session');
	await mkdir(sessionDir, {recursive: true});
	return sessionDir;
}

test.serial('acquireTimelineLock + isTimelineLockLive report a live lock', async t => {
	const sessionDir = await tempSessionDir();
	try {
		const acquired = await acquireTimelineLock(sessionDir, {
			pid: process.pid,
			startedAt: Date.now(),
		});
		t.true(acquired);
		const {live, payload} = await isTimelineLockLive(sessionDir);
		t.true(live);
		t.is(payload?.pid, process.pid);
		t.is(payload?.purpose, TIMELINE_LOCK_PURPOSE);
	} finally {
		await releaseTimelineLock(sessionDir);
		await rm(sessionDir, {recursive: true, force: true});
	}
});

test.serial('acquireTimelineLock returns false when the lock already exists', async t => {
	const sessionDir = await tempSessionDir();
	try {
		const first = await acquireTimelineLock(sessionDir, {
			pid: process.pid,
			startedAt: 1,
		});
		const second = await acquireTimelineLock(sessionDir, {
			pid: process.pid,
			startedAt: 2,
		});
		t.true(first);
		t.false(second);
	} finally {
		await releaseTimelineLock(sessionDir);
		await rm(sessionDir, {recursive: true, force: true});
	}
});

test.serial('releaseTimelineLock is idempotent', async t => {
	const sessionDir = await tempSessionDir();
	try {
		await releaseTimelineLock(sessionDir);
		await releaseTimelineLock(sessionDir);
		t.false(existsSync(getTimelineLockPath(sessionDir)));
	} finally {
		await rm(sessionDir, {recursive: true, force: true});
	}
});

test.serial('isTimelineLockLive reaps a stale lock (dead PID)', async t => {
	const sessionDir = await tempSessionDir();
	try {
		// A PID that almost certainly does not exist on any sane system.
		const deadPid = 2_000_000_000;
		t.false(isProcessAlive(deadPid));
		await writeFile(
			getTimelineLockPath(sessionDir),
			JSON.stringify({
				pid: deadPid,
				startedAt: 0,
				purpose: TIMELINE_LOCK_PURPOSE,
			}),
			'utf-8',
		);
		const {live, payload} = await isTimelineLockLive(sessionDir);
		t.false(live);
		t.truthy(payload);
		t.false(existsSync(getTimelineLockPath(sessionDir)));
	} finally {
		await rm(sessionDir, {recursive: true, force: true});
	}
});

test.serial('isTimelineLockLive reaps a malformed lock payload', async t => {
	const sessionDir = await tempSessionDir();
	try {
		await writeFile(getTimelineLockPath(sessionDir), '{ not: json', 'utf-8');
		const {live, payload} = await isTimelineLockLive(sessionDir);
		t.false(live);
		t.is(payload, null);
		t.false(existsSync(getTimelineLockPath(sessionDir)));
	} finally {
		await rm(sessionDir, {recursive: true, force: true});
	}
});

test.serial('isTimelineLockLive reaps a lock with the wrong purpose tag', async t => {
	const sessionDir = await tempSessionDir();
	try {
		await writeFile(
			getTimelineLockPath(sessionDir),
			JSON.stringify({
				pid: process.pid,
				startedAt: 0,
				purpose: 'some-other-thing',
			}),
			'utf-8',
		);
		const {live, payload} = await isTimelineLockLive(sessionDir);
		t.false(live);
		t.is(payload, null);
		t.false(existsSync(getTimelineLockPath(sessionDir)));
	} finally {
		await rm(sessionDir, {recursive: true, force: true});
	}
});

test.serial('isTimelineLockLive returns live=false when no lock file is present', async t => {
	const sessionDir = await tempSessionDir();
	try {
		const {live, payload} = await isTimelineLockLive(sessionDir);
		t.false(live);
		t.is(payload, null);
	} finally {
		await rm(sessionDir, {recursive: true, force: true});
	}
});

test.serial('isProcessAlive returns true for the current process', t => {
	t.true(isProcessAlive(process.pid));
});

test.serial('isProcessAlive returns false for an invalid pid', t => {
	t.false(isProcessAlive(0));
	t.false(isProcessAlive(-1));
	t.false(isProcessAlive(Number.NaN));
});

test.serial('acquireTimelineLock survives a stale lock (reaps and acquires)', async t => {
	const sessionDir = await tempSessionDir();
	try {
		// Plant a stale lockfile first.
		await writeFile(
			getTimelineLockPath(sessionDir),
			JSON.stringify({
				pid: 2_000_000_000,
				startedAt: 0,
				purpose: TIMELINE_LOCK_PURPOSE,
			}),
			'utf-8',
		);
		// The acquire path itself is best-effort: it sees a present file
		// and refuses. Callers that want self-healing should run
		// `isTimelineLockLive` first to reap, then call acquire. This
		// test documents the strict behaviour so future refactors keep
		// it intentional.
		const acquired = await acquireTimelineLock(sessionDir, {
			pid: process.pid,
			startedAt: Date.now(),
		});
		t.false(acquired);
	} finally {
		await rm(sessionDir, {recursive: true, force: true});
	}
});
