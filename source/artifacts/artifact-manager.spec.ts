import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {ArtifactManager} from './artifact-manager';

test('plans are persisted in isolated session directories', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-artifacts-'));
	const manager = new ArtifactManager(root);
	const firstSession = '11111111-1111-4111-8111-111111111111';
	const secondSession = '22222222-2222-4222-8222-222222222222';

	try {
		const firstPath = await manager.writeArtifact(
			firstSession,
			'implementation_plan',
			'# First plan\n',
		);
		const secondPath = await manager.writeArtifact(
			secondSession,
			'implementation_plan',
			'# Second plan\n',
		);

		t.is(await readFile(firstPath, 'utf8'), '# First plan\n');
		t.is(await readFile(secondPath, 'utf8'), '# Second plan\n');
		t.not(firstPath, secondPath);
		t.is(await manager.readArtifact(firstSession, 'implementation_plan'), '# First plan\n');
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('deleting one session leaves other session artifacts intact', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-artifacts-'));
	const manager = new ArtifactManager(root);
	const firstSession = '11111111-1111-4111-8111-111111111111';
	const secondSession = '22222222-2222-4222-8222-222222222222';

	try {
		await manager.writeArtifact(firstSession, 'task', '# First tasks\n');
		await manager.writeArtifact(secondSession, 'task', '# Second tasks\n');

		await manager.deleteSessionArtifacts(firstSession);

		t.is(await manager.readArtifact(firstSession, 'task'), null);
		t.is(await manager.readArtifact(secondSession, 'task'), '# Second tasks\n');
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('artifact paths reject non-UUID session identifiers', t => {
	const manager = new ArtifactManager('/tmp/nanocoder-artifacts-unused');

	t.throws(() => manager.getArtifactPath('../outside', 'tasks'), {
		message: /Invalid session ID/,
	});
});

test('artifact paths accept every UUID accepted by session storage', t => {
	const manager = new ArtifactManager('/tmp/nanocoder-artifacts-unused');
	const sessionId = '11111111-1111-0111-0111-111111111111';

	t.true(manager.getArtifactPath(sessionId, 'tasks').endsWith('/tasks.json'));
});

test('artifact cleanup ignores invalid external session identifiers', async t => {
	const manager = new ArtifactManager('/tmp/nanocoder-artifacts-unused');

	await t.notThrowsAsync(manager.deleteSessionArtifacts('../outside'));
});

test('safe artifact path lookup omits invalid external session identifiers', t => {
	const manager = new ArtifactManager('/tmp/nanocoder-artifacts-unused');

	t.is(manager.tryGetArtifactPath('../outside', 'task'), undefined);
	t.true(
		manager
			.tryGetArtifactPath(
				'11111111-1111-4111-8111-111111111111',
				'task',
			)
			?.endsWith('/task.md'),
	);
});

test('stale plain artifact cleanup removes only marked dead sessions', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-artifacts-'));
	const manager = new ArtifactManager(root);
	const persistedSession = '11111111-1111-4111-8111-111111111111';
	const deadPlainSession = '22222222-2222-4222-8222-222222222222';
	const livePlainSession = '33333333-3333-4333-8333-333333333333';

	try {
		await manager.writeArtifact(persistedSession, 'task', '# Persisted\n');
		await manager.markEphemeralSession(deadPlainSession, 101);
		await manager.writeArtifact(deadPlainSession, 'task', '# Dead plain\n');
		await manager.markEphemeralSession(livePlainSession, 202);
		await manager.writeArtifact(livePlainSession, 'task', '# Live plain\n');

		await manager.cleanupStaleEphemeralSessions(pid => pid === 202);

		t.is(await manager.readArtifact(persistedSession, 'task'), '# Persisted\n');
		t.is(await manager.readArtifact(deadPlainSession, 'task'), null);
		t.is(await manager.readArtifact(livePlainSession, 'task'), '# Live plain\n');
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('lists only user-facing lifecycle artifacts in order', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-artifacts-'));
	const manager = new ArtifactManager(root);
	const sessionId = '11111111-1111-4111-8111-111111111111';

	try {
		await manager.writeArtifact(sessionId, 'tasks', '[]');
		await manager.writeArtifact(sessionId, 'task', '# Tasks\n');
		await manager.writeArtifact(
			sessionId,
			'implementation_plan',
			'# Plan\n',
		);
		await manager.writeArtifact(sessionId, 'walkthrough', '# Walkthrough\n');

		t.deepEqual(await manager.listArtifacts(sessionId), [
			{
				kind: 'implementation_plan',
				path: manager.getArtifactPath(sessionId, 'implementation_plan'),
			},
			{kind: 'task', path: manager.getArtifactPath(sessionId, 'task')},
			{
				kind: 'walkthrough',
				path: manager.getArtifactPath(sessionId, 'walkthrough'),
			},
		]);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('cleanupOrphanedSessions reclaims directories with no surviving session', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-artifact-gc-'));
	const manager = new ArtifactManager(root);
	const kept = '11111111-1111-4111-8111-111111111111';
	const orphan = '22222222-2222-4222-8222-222222222222';
	const ephemeral = '33333333-3333-4333-8333-333333333333';

	try {
		await manager.writeArtifact(kept, 'implementation_plan', '# keep');
		await manager.writeArtifact(orphan, 'implementation_plan', '# drop');
		await manager.markEphemeralSession(ephemeral);
		await manager.writeArtifact(ephemeral, 'implementation_plan', '# plain');

		// minAgeMs 0 so the just-written directories are all eligible.
		await manager.cleanupOrphanedSessions([kept], 0);

		t.truthy(await manager.readArtifact(kept, 'implementation_plan'));
		t.is(await manager.readArtifact(orphan, 'implementation_plan'), null);
		t.truthy(
			await manager.readArtifact(ephemeral, 'implementation_plan'),
			'ephemeral plain-shell directories are left to their own sweep',
		);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('cleanupOrphanedSessions spares recently touched directories', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-artifact-gc-'));
	const manager = new ArtifactManager(root);
	const recent = '44444444-4444-4444-8444-444444444444';

	try {
		await manager.writeArtifact(recent, 'implementation_plan', '# in flight');
		await manager.cleanupOrphanedSessions([]);
		t.truthy(
			await manager.readArtifact(recent, 'implementation_plan'),
			'a session mid first-autosave must not be swept',
		);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});
