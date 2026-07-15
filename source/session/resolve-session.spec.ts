import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {resolveSession} from './resolve-session.js';
import {SessionManager} from './session-manager.js';

let testDir: string;
let manager: SessionManager;

const CWD_A = '/projects/a';
const CWD_B = '/projects/b';

test.beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), 'resolve-session-test-'));
	manager = new SessionManager(join(testDir, 'sessions'));
	await manager.initialize();
});

test.afterEach(async () => {
	if (testDir) {
		await rm(testDir, {recursive: true, force: true});
	}
});

async function createSession(
	workingDirectory: string,
	title: string,
	lastAccessedAtOffsetMs = 0,
) {
	const session = await manager.createSession({
		title,
		messageCount: 1,
		provider: 'openai',
		model: 'gpt-4',
		workingDirectory,
		messages: [{role: 'user', content: title}],
	});
	if (lastAccessedAtOffsetMs !== 0) {
		await manager.saveSession({
			...session,
			lastAccessedAt: new Date(
				Date.now() + lastAccessedAtOffsetMs,
			).toISOString(),
		});
	}
	return session;
}

test.serial('resolves "last" to the most recently accessed session in scope', async t => {
	await createSession(CWD_A, 'older', -10_000);
	const newer = await createSession(CWD_A, 'newer');

	const result = await resolveSession('last', CWD_A, {manager});

	t.true(result.ok);
	if (result.ok) t.is(result.session.id, newer.id);
});

test.serial('treats an undefined arg the same as "last"', async t => {
	const only = await createSession(CWD_A, 'only');

	const result = await resolveSession(undefined, CWD_A, {manager});

	t.true(result.ok);
	if (result.ok) t.is(result.session.id, only.id);
});

test.serial('resolves a 1-based index into the scoped, most-recent-first list', async t => {
	const newer = await createSession(CWD_A, 'newer');
	const older = await createSession(CWD_A, 'older', -10_000);

	const first = await resolveSession('1', CWD_A, {manager});
	const second = await resolveSession('2', CWD_A, {manager});

	t.true(first.ok);
	t.true(second.ok);
	if (first.ok) t.is(first.session.id, newer.id);
	if (second.ok) t.is(second.session.id, older.id);
});

test.serial('resolves a raw session uuid directly, even from a different cwd', async t => {
	const session = await createSession(CWD_B, 'other-project-session');

	// Scoped to CWD_A (not CWD_B), yet the raw uuid still resolves — loadSession
	// isn't filtered by workingDirectory, matching pre-refactor /resume behavior.
	const result = await resolveSession(session.id, CWD_A, {manager});

	t.true(result.ok);
	if (result.ok) t.is(result.session.id, session.id);
});

test.serial('returns not-found for an id that does not exist', async t => {
	const result = await resolveSession(
		'00000000-0000-4000-8000-000000000000',
		CWD_A,
		{manager},
	);

	t.false(result.ok);
	if (!result.ok) t.is(result.reason, 'not-found');
});

test.serial('returns not-found for an out-of-range index', async t => {
	await createSession(CWD_A, 'only');

	const result = await resolveSession('99', CWD_A, {manager});

	t.false(result.ok);
	if (!result.ok) t.is(result.reason, 'not-found');
});

test.serial('returns empty when resolving "last" against an empty scoped list', async t => {
	// Session exists, but in a different cwd than we're scoping to.
	await createSession(CWD_B, 'unrelated');

	const result = await resolveSession('last', CWD_A, {manager});

	t.false(result.ok);
	if (!result.ok) t.is(result.reason, 'empty');
});

test.serial('returns empty when resolving "last" against a fully empty list', async t => {
	const result = await resolveSession('last', CWD_A, {manager});

	t.false(result.ok);
	if (!result.ok) t.is(result.reason, 'empty');
});

test.serial('the `all` option resolves "last" across every cwd', async t => {
	await createSession(CWD_A, 'a-session', -10_000);
	const newestOverall = await createSession(CWD_B, 'b-session');

	const result = await resolveSession('last', CWD_A, {manager, all: true});

	t.true(result.ok);
	if (result.ok) t.is(result.session.id, newestOverall.id);
});

test.serial('a digit-prefixed uuid is treated as a raw id, not an index', async t => {
	// 6 sessions so parseInt('5e4b…') === 5 would be an in-range index.
	for (let i = 0; i < 6; i++) {
		await createSession(CWD_A, `session-${i}`, -i * 1000);
	}

	const result = await resolveSession(
		'5e4b0000-0000-4000-8000-000000000000',
		CWD_A,
		{manager},
	);

	t.false(result.ok);
	if (!result.ok) t.is(result.reason, 'not-found');
});
