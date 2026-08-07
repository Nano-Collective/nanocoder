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
