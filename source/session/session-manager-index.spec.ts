import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, readdir, readFile, rm, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'ava';
import {type Session, SessionManager} from './session-manager.js';

console.log('\nsession-manager-index.spec.ts');

// Every Nanocoder process (other terminals, the VS Code extension, parallel
// `nanocoder run`s) shares one session store. Each SessionManager instance has
// its own in-process queue, so several instances on one directory stand in for
// several processes here (#1706).

let sessionsDir: string;

test.beforeEach(async () => {
	sessionsDir = await mkdtemp(join(tmpdir(), 'session-index-test-'));
});

test.afterEach.always(async () => {
	await rm(sessionsDir, {recursive: true, force: true});
});

const sessionData = (title: string) => ({
	title,
	messageCount: 1,
	provider: 'test',
	model: 'test-model',
	workingDirectory: '/tmp/project',
	messages: [{role: 'user' as const, content: title}],
});

const indexedIds = async () => {
	const raw = await readFile(join(sessionsDir, 'sessions.json'), 'utf-8');
	return (JSON.parse(raw) as {id: string}[]).map(s => s.id).sort();
};

test.serial('concurrent saves from separate managers keep every index entry', async t => {
	const managers = Array.from({length: 8}, () => new SessionManager(sessionsDir));
	for (const manager of managers) await manager.initialize();

	const saved = await Promise.all(
		managers.map((manager, i) => manager.createSession(sessionData(`s${i}`))),
	);

	t.deepEqual(await indexedIds(), saved.map(s => s.id).sort());
	const entries = await readdir(sessionsDir);
	t.false(entries.includes('sessions.json.lock'), 'the lock is released');
});

// The same race through real OS processes: each worker loads the production
// SessionManager, waits at a file barrier until all of them are ready, then
// saves one session at once.
const WORKER = `
import {existsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [managerPath, sessionsDir, barrierDir, tag] = process.argv.slice(2);
const {SessionManager} = await import(pathToFileURL(managerPath).href);
const manager = new SessionManager(sessionsDir);
await manager.initialize();
writeFileSync(join(barrierDir, tag + '.ready'), '');
while (!existsSync(join(barrierDir, 'go'))) {
	await new Promise(resolve => setTimeout(resolve, 2));
}
await manager.createSession({
	title: tag,
	messageCount: 1,
	provider: 'test',
	model: 'test-model',
	workingDirectory: '/tmp/project',
	messages: [{role: 'user', content: tag}],
});
`;

test.serial('concurrent saves from separate processes keep every index entry', async t => {
	t.timeout(120_000);
	const workDir = await mkdtemp(join(tmpdir(), 'session-index-procs-'));
	t.teardown(() => rm(workDir, {recursive: true, force: true}));
	const workerPath = join(workDir, 'worker.mjs');
	await writeFile(workerPath, WORKER);
	const managerPath = fileURLToPath(new URL('./session-manager.ts', import.meta.url));
	const tsx = fileURLToPath(import.meta.resolve('tsx'));
	const tags = ['p0', 'p1', 'p2', 'p3'];

	const exits = tags.map(
		tag =>
			new Promise<number | null>(resolveExit => {
				const child = spawn(
					process.execPath,
					['--import', tsx, workerPath, managerPath, sessionsDir, workDir, tag],
					{
						env: {...process.env, NANOCODER_CONFIG_DIR: workDir},
						stdio: 'ignore',
					},
				);
				child.on('exit', resolveExit);
			}),
	);
	while (!tags.every(tag => existsSync(join(workDir, `${tag}.ready`)))) {
		await new Promise(resolveWait => setTimeout(resolveWait, 20));
	}
	await writeFile(join(workDir, 'go'), '');

	t.deepEqual(await Promise.all(exits), [0, 0, 0, 0]);
	const index = JSON.parse(
		await readFile(join(sessionsDir, 'sessions.json'), 'utf-8'),
	) as Session[];
	t.deepEqual(index.map(s => s.title).sort(), tags);
});

test.serial('startup re-indexes a session file the index lost', async t => {
	const first = new SessionManager(sessionsDir);
	await first.initialize();
	const kept = await first.createSession(sessionData('kept'));
	const lost = await first.createSession(sessionData('lost'));

	// What a lost update leaves behind: the file is on disk, the index entry is not.
	const index = JSON.parse(
		await readFile(join(sessionsDir, 'sessions.json'), 'utf-8'),
	) as Session[];
	await writeFile(
		join(sessionsDir, 'sessions.json'),
		JSON.stringify(index.filter(s => s.id !== lost.id)),
	);

	const next = new SessionManager(sessionsDir);
	await next.initialize();

	t.deepEqual(
		(await next.listSessions()).map(s => s.id).sort(),
		[kept.id, lost.id].sort(),
	);
});

test.serial('startup rebuilds a missing index from the session files', async t => {
	const first = new SessionManager(sessionsDir);
	await first.initialize();
	const one = await first.createSession(sessionData('one'));
	const two = await first.createSession(sessionData('two'));
	await unlink(join(sessionsDir, 'sessions.json'));

	const next = new SessionManager(sessionsDir);
	await next.initialize();

	t.deepEqual(await indexedIds(), [one.id, two.id].sort());
});

test.serial('startup drops index entries whose session file is gone', async t => {
	const first = new SessionManager(sessionsDir);
	await first.initialize();
	const kept = await first.createSession(sessionData('kept'));
	const gone = await first.createSession(sessionData('gone'));
	await unlink(join(sessionsDir, `${gone.id}.json`));

	const next = new SessionManager(sessionsDir);
	await next.initialize();

	t.deepEqual(await indexedIds(), [kept.id]);
});

test.serial('startup leaves a consistent index untouched and ignores non-session files', async t => {
	const first = new SessionManager(sessionsDir);
	await first.initialize();
	await first.createSession(sessionData('only'));
	await writeFile(join(sessionsDir, 'notes.json'), '{"not": "a session"}');
	const before = await readFile(join(sessionsDir, 'sessions.json'), 'utf-8');

	const next = new SessionManager(sessionsDir);
	await next.initialize();

	t.is(await readFile(join(sessionsDir, 'sessions.json'), 'utf-8'), before);
});

test.serial('initialize creates an empty index in an empty directory', async t => {
	const manager = new SessionManager(sessionsDir);
	await manager.initialize();
	t.deepEqual(await indexedIds(), []);
});
