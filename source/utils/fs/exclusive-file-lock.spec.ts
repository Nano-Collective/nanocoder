import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'ava';
import {withExclusiveLock} from './exclusive-file-lock.js';

console.log('\nexclusive-file-lock.spec.ts');

let dir: string;

test.beforeEach(async () => {
	dir = await fs.mkdtemp(join(tmpdir(), 'exclusive-file-lock-'));
});

test.afterEach.always(async () => {
	await fs.rm(dir, {recursive: true, force: true});
});

/** A pid that belonged to a process which has already exited. */
async function deadPid(): Promise<number> {
	const child = spawn(process.execPath, ['-e', '']);
	await new Promise(resolveExit => child.on('exit', resolveExit));
	return child.pid as number;
}

// Windows reports a lock file that another process is deleting as EPERM (or
// EACCES / EBUSY) until the delete completes. Those must be waited out, not
// turned into a failed save.
for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
	test.serial(`retries when creating the lock fails with ${code}`, async t => {
		const lockPath = join(dir, 'index.json.lock');
		const realOpen = fs.open;
		let failures = 0;
		fs.open = (async (...args: Parameters<typeof realOpen>) => {
			if (args[0] === lockPath && failures < 3) {
				failures++;
				throw Object.assign(new Error(code), {code});
			}
			return realOpen(...args);
		}) as typeof fs.open;
		try {
			t.is(await withExclusiveLock(lockPath, async () => 'ran'), 'ran');
		} finally {
			fs.open = realOpen;
		}
		t.is(failures, 3);
		t.false(existsSync(lockPath), 'the lock is released');
	});
}

test.serial('an error thrown by the operation is not retried as contention', async t => {
	const lockPath = join(dir, 'index.json.lock');
	let runs = 0;
	await t.throwsAsync(
		withExclusiveLock(lockPath, async () => {
			runs++;
			throw Object.assign(new Error('read-only store'), {code: 'EPERM'});
		}),
		{message: 'read-only store'},
	);
	t.is(runs, 1);
	t.false(existsSync(lockPath));
});

test.serial('a reclaim guard left behind by a crashed waiter is cleared', async t => {
	const lockPath = join(dir, 'index.json.lock');
	const guardPath = `${lockPath}.reclaim`;
	await fs.writeFile(lockPath, String(await deadPid()));
	await fs.writeFile(guardPath, String(await deadPid()));
	const old = new Date(Date.now() - 60_000);
	await fs.utimes(guardPath, old, old);

	t.is(await withExclusiveLock(lockPath, async () => 'ran'), 'ran');
	t.false(existsSync(guardPath));
	t.false(existsSync(lockPath));
});

// Several processes finding the same abandoned lock at once must still take
// it one at a time. Each worker logs when it enters and leaves the critical
// section; any overlap shows up as two enters in a row.
const WORKER = `
import {existsSync, writeFileSync} from 'node:fs';
import {appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [lockModule, lockPath, barrierDir, logPath, tag] = process.argv.slice(2);
const {withExclusiveLock} = await import(pathToFileURL(lockModule).href);
writeFileSync(join(barrierDir, tag + '.ready'), '');
while (!existsSync(join(barrierDir, 'go'))) {
	await new Promise(resolve => setTimeout(resolve, 2));
}
await withExclusiveLock(lockPath, async () => {
	await appendFile(logPath, 'enter ' + tag + '\\n');
	await new Promise(resolve => setTimeout(resolve, 30));
	await appendFile(logPath, 'exit ' + tag + '\\n');
});
`;

test.serial('several processes reclaiming one stale lock take it one at a time', async t => {
	t.timeout(120_000);
	const lockPath = join(dir, 'index.json.lock');
	const logPath = join(dir, 'log.txt');
	const workerPath = join(dir, 'worker.mjs');
	await fs.writeFile(workerPath, WORKER);
	await fs.writeFile(logPath, '');
	// Left by a process that crashed while holding it.
	await fs.writeFile(lockPath, String(await deadPid()));

	const lockModule = fileURLToPath(
		new URL('./exclusive-file-lock.ts', import.meta.url),
	);
	// A file URL, not a path: on Windows `--import` rejects a bare `C:\\...`.
	const tsx = import.meta.resolve('tsx');
	const tags = ['w0', 'w1', 'w2', 'w3', 'w4', 'w5'];

	const workers = tags.map(tag => {
		const child = spawn(
			process.execPath,
			['--import', tsx, workerPath, lockModule, lockPath, dir, logPath, tag],
			{stdio: ['ignore', 'ignore', 'pipe']},
		);
		let stderr = '';
		child.stderr?.on('data', chunk => {
			stderr += String(chunk);
		});
		let exitCode: number | null | undefined;
		const exited = new Promise<number | null>(resolveExit => {
			const finish = (code: number | null) => {
				exitCode = code;
				resolveExit(code);
			};
			child.on('exit', finish);
			child.on('error', () => finish(null));
		});
		return {tag, child, exited, exitCode: () => exitCode, stderr: () => stderr};
	});
	t.teardown(() => {
		for (const {child} of workers) child.kill();
	});

	const isReady = (tag: string) => existsSync(join(dir, `${tag}.ready`));
	while (!tags.every(isReady)) {
		const dead = workers.find(w => w.exitCode() !== undefined && !isReady(w.tag));
		if (dead) {
			t.fail(
				`worker ${dead.tag} exited (${dead.exitCode()}) before it was ready:\n${dead.stderr()}`,
			);
			return;
		}
		await new Promise(resolveWait => setTimeout(resolveWait, 20));
	}
	await fs.writeFile(join(dir, 'go'), '');

	t.deepEqual(
		await Promise.all(workers.map(w => w.exited)),
		tags.map(() => 0),
	);
	const events = (await fs.readFile(logPath, 'utf8')).trim().split('\n');
	t.is(events.length, tags.length * 2);
	for (let i = 0; i < events.length; i += 2) {
		const [enter, exit] = [events[i], events[i + 1]];
		t.true(
			enter?.startsWith('enter ') &&
				exit === `exit ${enter.slice('enter '.length)}`,
			`overlapping holders:\n${events.join('\n')}`,
		);
	}
	t.false(existsSync(lockPath));
	t.false(existsSync(`${lockPath}.reclaim`));
});
