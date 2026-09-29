import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'ava';
import {collectStorageReport} from './diagnostics';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const SAVED_ID = '11111111-1111-4111-8111-111111111111';
const MISSING_ID = '22222222-2222-4222-8222-222222222222';
const UNINDEXED_ID = '33333333-3333-4333-8333-333333333333';
const ORPHAN_ID = '44444444-4444-4444-8444-444444444444';
const EPHEMERAL_ID = '55555555-5555-4555-8555-555555555555';
const RECENT_ID = '66666666-6666-4666-8666-666666666666';

async function fixture(t: Parameters<typeof test>[0]) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nanocoder-storage-'));
	t.teardown(async () => fs.rm(root, {recursive: true, force: true}));
	const projectRoot = path.join(root, 'project');
	const appDataDir = path.join(root, 'appdata');
	const sessionsDir = path.join(appDataDir, 'sessions');
	const configDir = path.join(root, 'config');
	await fs.mkdir(projectRoot, {recursive: true});
	return {root, projectRoot, appDataDir, sessionsDir, configDir};
}

function session(id: string, workingDirectory: string) {
	return {
		id,
		title: 'A saved session',
		createdAt: NOW.toISOString(),
		lastAccessedAt: NOW.toISOString(),
		messageCount: 0,
		provider: 'test',
		model: 'test',
		workingDirectory,
		messages: [],
	};
}

test('empty stores are reported without creating any storage directories', async t => {
	const {projectRoot, appDataDir, sessionsDir, configDir} = await fixture(t);
	const report = await collectStorageReport({
		projectRoot,
		appDataDir,
		sessionsDir,
		configDir,
		now: NOW,
	});
	t.is(report.version, 1);
	for (const store of Object.values(report.sections)) {
		t.is(store.count, 0);
		t.is(store.sizeBytes, 0);
		t.deepEqual(store.findings, []);
		await t.throwsAsync(fs.lstat(store.root), {code: 'ENOENT'});
	}
	await t.throwsAsync(fs.lstat(configDir), {code: 'ENOENT'});
});

test('project session preferences select a project-local store without changing them', async t => {
	const {projectRoot, appDataDir, configDir} = await fixture(t);
	const configPath = path.join(projectRoot, 'nanocoder-preferences.json');
	const contents = JSON.stringify({
		nanocoder: {
			sessions: {directory: 'custom-sessions', maxSessions: 7, retentionDays: 5},
		},
	});
	await fs.writeFile(configPath, contents);
	const report = await collectStorageReport({
		projectRoot,
		appDataDir,
		configDir,
		now: NOW,
	});
	t.is(report.sections.sessions.scope, 'project');
	t.is(report.sections.sessions.root, path.join(projectRoot, 'custom-sessions'));
	t.deepEqual(report.sections.sessions.limits, [
		{label: 'Max saved sessions', value: '7'},
		{label: 'Retention', value: '5 days'},
	]);
	t.is(await fs.readFile(configPath, 'utf8'), contents);
	await t.throwsAsync(fs.lstat(configDir), {code: 'ENOENT'});
});

test('sessions and artifacts report mismatches without treating active folders as orphaned', async t => {
	const {projectRoot, appDataDir, sessionsDir, configDir} = await fixture(t);
	const artifactsDir = path.join(appDataDir, 'artifacts');
	await fs.mkdir(sessionsDir, {recursive: true});
	await fs.writeFile(
		path.join(sessionsDir, 'sessions.json'),
		JSON.stringify([
			session(SAVED_ID, projectRoot),
			session(MISSING_ID, projectRoot),
		]),
	);
	await fs.writeFile(
		path.join(sessionsDir, `${SAVED_ID}.json`),
		JSON.stringify(session(SAVED_ID, projectRoot)),
	);
	await fs.writeFile(
		path.join(sessionsDir, `${UNINDEXED_ID}.json`),
		JSON.stringify(session(UNINDEXED_ID, projectRoot)),
	);
	await fs.writeFile(path.join(sessionsDir, `${ORPHAN_ID}.json`), '{bad json');
	for (const id of [SAVED_ID, ORPHAN_ID, EPHEMERAL_ID, RECENT_ID]) {
		const dir = path.join(artifactsDir, id);
		await fs.mkdir(dir, {recursive: true});
		await fs.writeFile(path.join(dir, 'task.md'), 'task');
		if (id !== RECENT_ID) {
			await fs.utimes(dir, new Date('2026-09-20'), new Date('2026-09-20'));
		}
	}
	await fs.writeFile(
		path.join(artifactsDir, EPHEMERAL_ID, '.ephemeral.json'),
		JSON.stringify({pid: process.pid}),
	);
	const indexPath = path.join(sessionsDir, 'sessions.json');
	const indexBefore = await fs.stat(indexPath);
	const report = await collectStorageReport({
		projectRoot,
		appDataDir,
		sessionsDir,
		configDir,
		now: NOW,
	});
	t.is(report.sections.sessions.count, 3);
	t.true(report.sections.sessions.sizeBytes > 0);
	t.deepEqual(
		report.sections.sessions.findings.map(f => f.code).sort(),
		[
			'session_invalid',
			'session_missing',
			'session_unindexed',
		],
	);
	t.is(report.sections.artifacts.count, 4);
	t.deepEqual(
		report.sections.artifacts.findings.map(f => f.code),
		['artifact_unassociated'],
	);
	t.is(
		report.sections.artifacts.items.find(item => item.name === ORPHAN_ID)?.status,
		'warning',
	);
	t.is(
		report.sections.artifacts.items.find(item => item.name === ORPHAN_ID)
			?.ageDays,
		5,
	);
	t.is(
		report.sections.artifacts.items.find(item => item.name === EPHEMERAL_ID)
			?.status,
		'ok',
	);
	t.is(
		report.sections.artifacts.items.find(item => item.name === RECENT_ID)
			?.status,
		'ok',
	);
	t.is((await fs.stat(indexPath)).mtimeMs, indexBefore.mtimeMs);
	t.is((await fs.readFile(indexPath, 'utf8')).length > 0, true);
});

test('unreadable session index cannot prove artifact ownership', async t => {
	const {projectRoot, appDataDir, sessionsDir, configDir} = await fixture(t);
	const oldArtifact = path.join(appDataDir, 'artifacts', ORPHAN_ID);
	await fs.mkdir(sessionsDir, {recursive: true});
	await fs.writeFile(path.join(sessionsDir, 'sessions.json'), '{bad json');
	await fs.mkdir(oldArtifact, {recursive: true});
	await fs.utimes(oldArtifact, new Date('2026-09-20'), new Date('2026-09-20'));
	const report = await collectStorageReport({
		projectRoot,
		appDataDir,
		sessionsDir,
		configDir,
		now: NOW,
	});
	t.true(report.sections.sessions.findings.some(f => f.code === 'index_invalid'));
	t.true(
		report.sections.artifacts.findings.some(f => f.code === 'ownership_unknown'),
	);
	t.false(
		report.sections.artifacts.findings.some(
			f => f.code === 'artifact_unassociated',
		),
	);
});

test('dead ephemeral artifact is reported as reclaimable, not healthy', async t => {
	const {projectRoot, appDataDir, sessionsDir, configDir} = await fixture(t);
	const dir = path.join(appDataDir, 'artifacts', EPHEMERAL_ID);
	await fs.mkdir(dir, {recursive: true});
	await fs.writeFile(
		path.join(dir, '.ephemeral.json'),
		JSON.stringify({pid: 2147483647}),
	);
	const report = await collectStorageReport({
		projectRoot,
		appDataDir,
		sessionsDir,
		configDir,
		now: NOW,
	});
	t.is(report.sections.artifacts.items[0]?.status, 'warning');
	t.true(
		report.sections.artifacts.findings.some(
			f => f.code === 'artifact_ephemeral_stale',
		),
	);
});

test('project-local timeline and checkpoint corruption is reported, never repaired', async t => {
	const {projectRoot, appDataDir, sessionsDir, configDir} = await fixture(t);
	const timeline = path.join(projectRoot, '.nanocoder', 'timeline', SAVED_ID);
	const checkpoint = path.join(projectRoot, '.nanocoder', 'checkpoints', 'v1');
	const broken = path.join(projectRoot, '.nanocoder', 'checkpoints', 'broken');
	await fs.mkdir(timeline, {recursive: true});
	await fs.writeFile(
		path.join(timeline, 'timeline.json'),
		JSON.stringify({nextSeq: 2, entries: [{id: 'one'}]}),
	);
	await fs.utimes(timeline, new Date('2026-09-01'), new Date('2026-09-01'));
	await fs.mkdir(checkpoint, {recursive: true});
	await fs.writeFile(
		path.join(checkpoint, 'metadata.json'),
		JSON.stringify({
			name: 'v1',
			timestamp: NOW.toISOString(),
			messageCount: 2,
			filesChanged: ['src/missing.ts'],
			skippedFiles: [{path: 'src/locked.ts', reason: 'unreadable'}],
		}),
	);
	await fs.writeFile(
		path.join(checkpoint, 'conversation.json'),
		JSON.stringify({messages: []}),
	);
	await fs.mkdir(broken, {recursive: true});
	const report = await collectStorageReport({
		projectRoot,
		appDataDir,
		sessionsDir,
		configDir,
		now: NOW,
	});
	t.is(report.sections.timeline.scope, 'project');
	t.true(
		report.sections.timeline.findings.some(
			f => f.code === 'timeline_retention_threshold',
		),
	);
	t.is(report.sections.checkpoints.count, 2);
	t.deepEqual(
		report.sections.checkpoints.findings.map(f => f.code).sort(),
		[
			'checkpoint_incomplete',
			'checkpoint_invalid',
			'checkpoint_snapshot_missing',
		],
	);
	await t.throwsAsync(fs.lstat(path.join(broken, 'metadata.json')), {
		code: 'ENOENT',
	});
});

test('snapshot checks never follow a symlink out of the project store', async t => {
	if (process.platform === 'win32') {
		t.pass('Creating a directory symlink may require administrator privileges');
		return;
	}
	const {root, projectRoot, appDataDir, sessionsDir, configDir} = await fixture(t);
	const checkpoint = path.join(projectRoot, '.nanocoder', 'checkpoints', 'v1');
	const outside = path.join(root, 'outside');
	await fs.mkdir(checkpoint, {recursive: true});
	await fs.mkdir(outside);
	await fs.writeFile(path.join(outside, 'secret'), 'not a snapshot');
	await fs.symlink(outside, path.join(checkpoint, 'files'));
	await fs.writeFile(
		path.join(checkpoint, 'metadata.json'),
		JSON.stringify({
			name: 'v1',
			timestamp: NOW.toISOString(),
			messageCount: 1,
			filesChanged: ['secret'],
		}),
	);
	await fs.writeFile(
		path.join(checkpoint, 'conversation.json'),
		JSON.stringify({messages: []}),
	);
	const report = await collectStorageReport({
		projectRoot,
		appDataDir,
		sessionsDir,
		configDir,
		now: NOW,
	});
	t.true(
		report.sections.checkpoints.findings.some(
			f =>
				f.code === 'checkpoint_snapshot_missing' &&
				f.message.includes('snapshot directory'),
		),
	);
	t.true(
		report.sections.checkpoints.findings.some(f => f.code === 'symlink_skipped'),
	);
	t.is(
		report.sections.checkpoints.sizeBytes,
		(await fs.stat(path.join(checkpoint, 'metadata.json'))).size +
			(await fs.stat(path.join(checkpoint, 'conversation.json'))).size,
	);
});

test('unexpected files and directories are accounted for without being treated as sessions', async t => {
	const {projectRoot, appDataDir, sessionsDir, configDir} = await fixture(t);
	const artifacts = path.join(appDataDir, 'artifacts');
	const timeline = path.join(projectRoot, '.nanocoder', 'timeline');
	const checkpoints = path.join(projectRoot, '.nanocoder', 'checkpoints');
	await fs.mkdir(path.join(sessionsDir, `${SAVED_ID}.json`), {recursive: true});
	await fs.writeFile(path.join(sessionsDir, `${SAVED_ID}.json`, 'leftover'), 'abc');
	await fs.writeFile(path.join(sessionsDir, `${SAVED_ID}.json.tmp`), '12345');
	for (const root of [artifacts, timeline, checkpoints]) {
		await fs.mkdir(root, {recursive: true});
		await fs.writeFile(path.join(root, 'leftover.tmp'), '12345');
	}
	const report = await collectStorageReport({
		projectRoot,
		appDataDir,
		sessionsDir,
		configDir,
		now: NOW,
	});
	t.is(report.sections.sessions.count, 2);
	t.is(report.sections.sessions.sizeBytes, 8);
	t.false(report.sections.sessions.findings.some(f => f.code === 'session_invalid'));
	for (const store of [
		report.sections.artifacts,
		report.sections.timeline,
		report.sections.checkpoints,
	]) {
		t.is(store.sizeBytes, 5);
		t.is(store.findings[0]?.code, 'unexpected_entry');
	}
});

test('unsafe snapshot paths are reported at metadata, not outside the store', async t => {
	const {projectRoot, appDataDir, sessionsDir, configDir} = await fixture(t);
	const checkpoint = path.join(projectRoot, '.nanocoder', 'checkpoints', 'v1');
	await fs.mkdir(checkpoint, {recursive: true});
	await fs.writeFile(
		path.join(checkpoint, 'metadata.json'),
		JSON.stringify({
			name: 'v1',
			timestamp: NOW.toISOString(),
			messageCount: 0,
			filesChanged: ['../../outside', '/tmp/elsewhere'],
		}),
	);
	await fs.writeFile(
		path.join(checkpoint, 'conversation.json'),
		JSON.stringify({messages: []}),
	);
	const report = await collectStorageReport({
		projectRoot,
		appDataDir,
		sessionsDir,
		configDir,
		now: NOW,
	});
	const findings = report.sections.checkpoints.findings;
	t.is(findings.length, 2);
	t.true(findings.every(f => f.code === 'checkpoint_snapshot_unsafe'));
	t.true(findings.every(f => f.path === path.join(checkpoint, 'metadata.json')));
});
