import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {chmod, mkdtemp, readFile, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {ArtifactManager} from '@/artifacts/artifact-manager';
import {type Session, SessionManager} from './session-manager.js';

console.log('\nsession-artifact-sweep.spec.ts');

// The startup sweep runs before anything initializes the session manager,
// and with `sessions.autoSave: false` nothing ever does (#1704). It must still
// tell saved sessions from orphans, and keep everything when it cannot.

let testDir: string;
let sessionsDir: string;
let artifacts: ArtifactManager;
let artifactsRoot: string;

test.beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), 'session-artifact-sweep-'));
	sessionsDir = join(testDir, 'sessions');
	artifactsRoot = join(testDir, 'artifacts');
	artifacts = new ArtifactManager(artifactsRoot);
});

test.afterEach.always(async () => {
	await chmod(sessionsDir, 0o700).catch(() => {});
	await rm(testDir, {recursive: true, force: true});
});

/** An artifact directory old enough for the sweep to consider it. */
async function oldArtifact(sessionId: string): Promise<void> {
	await artifacts.writeArtifact(sessionId, 'implementation_plan', '# plan\n');
	const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
	await utimes(join(artifactsRoot, sessionId), threeDaysAgo, threeDaysAgo);
}

async function saveSession(): Promise<Session> {
	const writer = new SessionManager(sessionsDir, artifacts);
	await writer.initialize();
	return writer.createSession({
		title: 'saved',
		messageCount: 1,
		provider: 'test',
		model: 'test-model',
		workingDirectory: '/tmp/project',
		messages: [{role: 'user', content: 'hello'}],
	});
}

const hasPlan = (sessionId: string) =>
	existsSync(join(artifactsRoot, sessionId));

test.serial('the startup sweep keeps a saved session\'s artifacts before the manager is initialized', async t => {
	const saved = await saveSession();
	const orphan = randomUUID();
	await oldArtifact(saved.id);
	await oldArtifact(orphan);

	// A fresh manager, swept the way startup does: no initialize() first.
	await new SessionManager(sessionsDir, artifacts).cleanupOrphanedArtifacts();

	t.true(hasPlan(saved.id), 'the saved session keeps its plan');
	t.false(hasPlan(orphan), 'a directory with no session is still reclaimed');
});

test.serial('a session file missing from the index still protects its artifacts', async t => {
	const saved = await saveSession();
	await oldArtifact(saved.id);
	const indexPath = join(sessionsDir, 'sessions.json');
	const index = JSON.parse(await readFile(indexPath, 'utf-8')) as Session[];
	await writeFile(
		indexPath,
		JSON.stringify(index.filter(s => s.id !== saved.id)),
	);

	await new SessionManager(sessionsDir, artifacts).cleanupOrphanedArtifacts();

	t.true(hasPlan(saved.id));
});

test.serial('an index entry whose session file is gone still protects its artifacts', async t => {
	const saved = await saveSession();
	await oldArtifact(saved.id);
	await rm(join(sessionsDir, `${saved.id}.json`));

	await new SessionManager(sessionsDir, artifacts).cleanupOrphanedArtifacts();

	t.true(hasPlan(saved.id));
});

test.serial('with no sessions directory, old orphaned artifacts are still reclaimed', async t => {
	const orphan = randomUUID();
	await oldArtifact(orphan);

	await new SessionManager(sessionsDir, artifacts).cleanupOrphanedArtifacts();

	t.false(existsSync(sessionsDir), 'the sweep does not create the store');
	t.false(hasPlan(orphan));
});

const posixNonRoot =
	process.platform !== 'win32' && process.getuid?.() !== 0 ? test.serial : test.skip;

posixNonRoot('an unreadable sessions directory keeps every artifact directory', async t => {
	const saved = await saveSession();
	const orphan = randomUUID();
	await oldArtifact(saved.id);
	await oldArtifact(orphan);
	await chmod(sessionsDir, 0o000);

	await new SessionManager(sessionsDir, artifacts).cleanupOrphanedArtifacts();

	t.true(hasPlan(saved.id), 'the saved session keeps its plan');
	t.true(hasPlan(orphan), 'nothing is swept when saved sessions cannot be listed');
});
