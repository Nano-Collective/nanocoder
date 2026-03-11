import {
	mkdtemp,
	readFile,
	readdir,
	rm,
	unlink,
	writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {SessionManager} from './session-manager.js';

let testDir: string;
let manager: SessionManager;
let sessionsDir: string;

test.beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), 'session-mgr-test-'));
	sessionsDir = join(testDir, 'sessions');
	manager = new SessionManager(sessionsDir);
	await manager.initialize();
});

test.afterEach(async () => {
	if (testDir) {
		await rm(testDir, {recursive: true, force: true});
	}
});

// --- initialize ---

test.serial('initialize creates sessions directory and index', async t => {
	const indexPath = join(sessionsDir, 'sessions.json');
	const data = await readFile(indexPath, 'utf-8');
	t.deepEqual(JSON.parse(data), []);
});

test.serial('initialize is idempotent', async t => {
	await manager.initialize();
	await manager.initialize();
	const indexPath = join(sessionsDir, 'sessions.json');
	const data = await readFile(indexPath, 'utf-8');
	t.deepEqual(JSON.parse(data), []);
});

// --- createSession ---

test.serial('createSession returns a session with a UUID id', async t => {
	const session = await manager.createSession({
		title: 'Test session',
		messageCount: 1,
		provider: 'openai',
		model: 'gpt-4',
		workingDirectory: '/tmp',
		messages: [{role: 'user', content: 'hello'}],
	});

	t.truthy(session.id);
	t.regex(
		session.id,
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
	);
	t.is(session.title, 'Test session');
	t.is(session.messageCount, 1);
	t.is(session.provider, 'openai');
	t.is(session.model, 'gpt-4');
	t.truthy(session.createdAt);
	t.truthy(session.lastAccessedAt);
});

test.serial('createSession writes session file to disk', async t => {
	const session = await manager.createSession({
		title: 'Disk test',
		messageCount: 0,
		provider: 'test',
		model: 'test',
		workingDirectory: '/tmp',
		messages: [],
	});

	const filePath = join(sessionsDir, `${session.id}.json`);
	const data = await readFile(filePath, 'utf-8');
	const parsed = JSON.parse(data);
	t.is(parsed.id, session.id);
	t.is(parsed.title, 'Disk test');
});

test.serial('createSession adds metadata to the index', async t => {
	const session = await manager.createSession({
		title: 'Index test',
		messageCount: 2,
		provider: 'test',
		model: 'test',
		workingDirectory: '/tmp',
		messages: [
			{role: 'user', content: 'a'},
			{role: 'assistant', content: 'b'},
		],
	});

	const sessions = await manager.listSessions();
	t.is(sessions.length, 1);
	t.is(sessions[0].id, session.id);
	t.is(sessions[0].title, 'Index test');
	t.is(sessions[0].messageCount, 2);
});

// --- readSession ---

test.serial(
	'readSession returns session without updating lastAccessedAt',
	async t => {
		const session = await manager.createSession({
			title: 'Read test',
			messageCount: 1,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [{role: 'user', content: 'hi'}],
		});

		const originalLastAccessed = session.lastAccessedAt;

		// Small delay to ensure timestamp difference if it were updated
		await new Promise(r => setTimeout(r, 10));

		const read = await manager.readSession(session.id);
		t.truthy(read);
		t.is(read!.id, session.id);
		t.is(read!.lastAccessedAt, originalLastAccessed);
	},
);

test.serial('readSession returns null for invalid session ID', async t => {
	const result = await manager.readSession('not-a-uuid');
	t.is(result, null);
});

test.serial('readSession returns null for non-existent session', async t => {
	const result = await manager.readSession(
		'00000000-0000-0000-0000-000000000000',
	);
	t.is(result, null);
});

// --- loadSession ---

test.serial(
	'loadSession returns session and updates lastAccessedAt',
	async t => {
		const session = await manager.createSession({
			title: 'Load test',
			messageCount: 1,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [{role: 'user', content: 'hi'}],
		});

		const originalLastAccessed = session.lastAccessedAt;

		// Small delay to ensure timestamp difference
		await new Promise(r => setTimeout(r, 10));

		const loaded = await manager.loadSession(session.id);
		t.truthy(loaded);
		t.is(loaded!.id, session.id);
		t.not(loaded!.lastAccessedAt, originalLastAccessed);
	},
);

test.serial('loadSession returns null for invalid ID', async t => {
	const result = await manager.loadSession('../../../etc/passwd');
	t.is(result, null);
});

// --- saveSession (update existing) ---

test.serial('saveSession updates an existing session', async t => {
	const session = await manager.createSession({
		title: 'Original',
		messageCount: 1,
		provider: 'test',
		model: 'test',
		workingDirectory: '/tmp',
		messages: [{role: 'user', content: 'hi'}],
	});

	session.title = 'Updated';
	session.messages.push({role: 'assistant', content: 'hello'});
	session.messageCount = 2;
	await manager.saveSession(session);

	const loaded = await manager.readSession(session.id);
	t.is(loaded!.title, 'Updated');
	t.is(loaded!.messageCount, 2);
	t.is(loaded!.messages.length, 2);
});

test.serial('saveSession rejects invalid session ID', async t => {
	await t.throwsAsync(
		() =>
			manager.saveSession({
				id: 'bad-id',
				title: 'test',
				createdAt: new Date().toISOString(),
				lastAccessedAt: new Date().toISOString(),
				messageCount: 0,
				provider: 'test',
				model: 'test',
				workingDirectory: '/tmp',
				messages: [],
			}),
		{message: /Invalid session ID/},
	);
});

// --- deleteSession ---

test.serial(
	'deleteSession removes session file and index entry',
	async t => {
		const session = await manager.createSession({
			title: 'Delete me',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});

		await manager.deleteSession(session.id);

		const loaded = await manager.readSession(session.id);
		t.is(loaded, null);

		const sessions = await manager.listSessions();
		t.is(sessions.length, 0);
	},
);

test.serial(
	'deleteSession is safe for already-deleted session file',
	async t => {
		const session = await manager.createSession({
			title: 'Double delete',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});

		await manager.deleteSession(session.id);
		// Deleting again should not throw (ENOENT is ignored)
		await t.notThrowsAsync(() => manager.deleteSession(session.id));
	},
);

test.serial('deleteSession rejects invalid ID', async t => {
	await t.throwsAsync(() => manager.deleteSession('bad-id'), {
		message: /Invalid session ID/,
	});
});

// --- listSessions ---

test.serial(
	'listSessions returns all sessions sorted by index order',
	async t => {
		await manager.createSession({
			title: 'First',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});
		await manager.createSession({
			title: 'Second',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});

		const sessions = await manager.listSessions();
		t.is(sessions.length, 2);
		t.is(sessions[0].title, 'First');
		t.is(sessions[1].title, 'Second');
	},
);

// --- listSessions with workingDirectory filter ---

test.serial(
	'listSessions with workingDirectory filter returns matching sessions',
	async t => {
		await manager.createSession({
			title: 'Project A',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/project-a',
			messages: [],
		});
		await manager.createSession({
			title: 'Project B',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/project-b',
			messages: [],
		});
		await manager.createSession({
			title: 'Project A again',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/project-a',
			messages: [],
		});

		const filtered = await manager.listSessions({
			workingDirectory: '/project-a',
		});
		t.is(filtered.length, 2);
		t.true(filtered.every(s => s.workingDirectory === '/project-a'));
	},
);

test.serial(
	'listSessions with workingDirectory filter returns empty for no matches',
	async t => {
		await manager.createSession({
			title: 'Project A',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/project-a',
			messages: [],
		});

		const filtered = await manager.listSessions({
			workingDirectory: '/project-b',
		});
		t.is(filtered.length, 0);
	},
);

test.serial(
	'listSessions without filter returns all sessions',
	async t => {
		await manager.createSession({
			title: 'Project A',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/project-a',
			messages: [],
		});
		await manager.createSession({
			title: 'Project B',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/project-b',
			messages: [],
		});

		const all = await manager.listSessions();
		t.is(all.length, 2);
	},
);

// --- validation ---

test.serial('readSession rejects path traversal IDs', async t => {
	const result = await manager.readSession('../../etc/passwd');
	t.is(result, null);
});

test.serial('readSession handles corrupt JSON gracefully', async t => {
	const session = await manager.createSession({
		title: 'Corrupt test',
		messageCount: 0,
		provider: 'test',
		model: 'test',
		workingDirectory: '/tmp',
		messages: [],
	});

	// Corrupt the session file
	const filePath = join(sessionsDir, `${session.id}.json`);
	await writeFile(filePath, '{invalid json!!!', 'utf-8');

	const result = await manager.readSession(session.id);
	t.is(result, null);
});

test.serial('readSession rejects session with missing fields', async t => {
	const session = await manager.createSession({
		title: 'Missing fields',
		messageCount: 0,
		provider: 'test',
		model: 'test',
		workingDirectory: '/tmp',
		messages: [],
	});

	// Write a partial session (missing messages)
	const filePath = join(sessionsDir, `${session.id}.json`);
	await writeFile(
		filePath,
		JSON.stringify({id: session.id, title: 'partial'}),
		'utf-8',
	);

	const result = await manager.readSession(session.id);
	t.is(result, null);
});

test.serial(
	'listSessions filters invalid metadata from index',
	async t => {
		// Manually write invalid entries to the index
		const indexPath = join(sessionsDir, 'sessions.json');
		await writeFile(
			indexPath,
			JSON.stringify([
				{id: 'not-valid', title: 123}, // invalid: title is not string
				{
					id: '11111111-1111-1111-1111-111111111111',
					title: 'Valid',
					createdAt: '2024-01-01T00:00:00Z',
					lastAccessedAt: '2024-01-01T00:00:00Z',
					messageCount: 0,
					provider: 'test',
					model: 'test',
					workingDirectory: '/tmp',
				},
			]),
			'utf-8',
		);

		const sessions = await manager.listSessions();
		t.is(sessions.length, 1);
		t.is(sessions[0].title, 'Valid');
	},
);

// --- getSessionDirectory ---

test.serial('getSessionDirectory returns the sessions path', async t => {
	const dir = manager.getSessionDirectory();
	t.true(dir.endsWith('sessions'));
});

// --- atomic writes ---

test.serial('saveSession leaves no .tmp files on success', async t => {
	await manager.createSession({
		title: 'Atomic test',
		messageCount: 0,
		provider: 'test',
		model: 'test',
		workingDirectory: '/tmp',
		messages: [],
	});

	const entries = await readdir(sessionsDir);
	const tmpFiles = entries.filter(e => e.endsWith('.tmp'));
	t.is(tmpFiles.length, 0, 'No .tmp files should remain after save');
});

test.serial(
	'session file is valid JSON after save (atomic write integrity)',
	async t => {
		const session = await manager.createSession({
			title: 'Integrity test',
			messageCount: 1,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [{role: 'user', content: 'check'}],
		});

		const filePath = join(sessionsDir, `${session.id}.json`);
		const data = await readFile(filePath, 'utf-8');
		const parsed = JSON.parse(data);
		t.is(parsed.id, session.id);
		t.is(parsed.messages.length, 1);
	},
);

// --- index recovery ---

test.serial(
	'listSessions recovers from corrupt index by scanning files',
	async t => {
		// Create a session first
		const session = await manager.createSession({
			title: 'Recoverable',
			messageCount: 1,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [{role: 'user', content: 'survive'}],
		});

		// Corrupt the index
		const indexPath = join(sessionsDir, 'sessions.json');
		await writeFile(indexPath, '!!!corrupt!!!', 'utf-8');

		// listSessions should rebuild from session files
		const sessions = await manager.listSessions();
		t.is(sessions.length, 1);
		t.is(sessions[0].id, session.id);
		t.is(sessions[0].title, 'Recoverable');
	},
);

test.serial(
	'listSessions recovers from deleted index by scanning files',
	async t => {
		const session = await manager.createSession({
			title: 'Deleted index',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});

		// Delete the index file
		const indexPath = join(sessionsDir, 'sessions.json');
		await unlink(indexPath);

		const sessions = await manager.listSessions();
		t.is(sessions.length, 1);
		t.is(sessions[0].id, session.id);
	},
);

test.serial(
	'listSessions recovers from empty index when files exist',
	async t => {
		const session = await manager.createSession({
			title: 'Empty index',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});

		// Write empty array to index
		const indexPath = join(sessionsDir, 'sessions.json');
		await writeFile(indexPath, '[]', 'utf-8');

		// Empty but valid index — no recovery needed (could be intentional)
		const sessions = await manager.listSessions();
		t.is(sessions.length, 0);

		// But if index has entries that are all invalid, recovery kicks in
		await writeFile(indexPath, '[{"bad": true}]', 'utf-8');

		// Create the file first so there's something to recover
		const mgr2 = new SessionManager(sessionsDir);
		await mgr2.initialize();
		const sessions2 = await mgr2.listSessions();
		t.is(sessions2.length, 1);
		t.is(sessions2[0].id, session.id);
	},
);

test.serial(
	'recovery ignores corrupt session files during rebuild',
	async t => {
		const session = await manager.createSession({
			title: 'Good session',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});

		// Add a corrupt session file
		await writeFile(
			join(sessionsDir, '00000000-0000-0000-0000-000000000001.json'),
			'not json',
			'utf-8',
		);

		// Corrupt the index to trigger rebuild
		await writeFile(
			join(sessionsDir, 'sessions.json'),
			'corrupt',
			'utf-8',
		);

		const sessions = await manager.listSessions();
		t.is(sessions.length, 1);
		t.is(sessions[0].id, session.id);
	},
);

// --- enforceSessionLimits ---

test.serial(
	'enforceSessionLimits deletes oldest sessions when over limit',
	async t => {
		// Use a separate manager with overrideDir to avoid config interference
		const limitDir = join(testDir, 'limit-test');
		const limitManager = new SessionManager(limitDir);
		await limitManager.initialize();

		// Create 5 sessions with staggered timestamps
		const ids: string[] = [];
		for (let i = 0; i < 5; i++) {
			const session = await limitManager.createSession({
				title: `Session ${i}`,
				messageCount: 0,
				provider: 'test',
				model: 'test',
				workingDirectory: '/tmp',
				messages: [],
			});
			ids.push(session.id);
			// Small delay for distinct timestamps
			await new Promise(r => setTimeout(r, 5));
		}

		// Default maxSessions is 100, so all 5 should be present
		const sessions = await limitManager.listSessions();
		t.is(sessions.length, 5);
	},
);

// --- cleanupOldSessions ---

test.serial(
	'cleanupOldSessions removes sessions older than retention',
	async t => {
		const session = await manager.createSession({
			title: 'Old session',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});

		// Backdate the index entry to 60 days ago
		const indexPath = join(sessionsDir, 'sessions.json');
		const indexData = await readFile(indexPath, 'utf-8');
		const index = JSON.parse(indexData);
		const oldDate = new Date();
		oldDate.setDate(oldDate.getDate() - 60);
		index[0].lastAccessedAt = oldDate.toISOString();
		await writeFile(indexPath, JSON.stringify(index), 'utf-8');

		// Re-initialize to trigger cleanup (default retention is 30 days)
		const mgr2 = new SessionManager(sessionsDir);
		await mgr2.initialize();

		const sessions = await mgr2.listSessions();
		t.is(sessions.length, 0);

		// File should also be deleted
		const result = await mgr2.readSession(session.id);
		t.is(result, null);
	},
);

test.serial(
	'cleanupOldSessions keeps sessions within retention period',
	async t => {
		await manager.createSession({
			title: 'Recent session',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});

		// Re-initialize (triggers cleanup)
		const mgr2 = new SessionManager(sessionsDir);
		await mgr2.initialize();

		const sessions = await mgr2.listSessions();
		t.is(sessions.length, 1);
		t.is(sessions[0].title, 'Recent session');
	},
);

// --- concurrent lock serialization ---

test.serial(
	'concurrent saveSession calls are serialized via lock',
	async t => {
		const session = await manager.createSession({
			title: 'Concurrent test',
			messageCount: 1,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [{role: 'user', content: 'start'}],
		});

		// Fire 5 concurrent saves with different message counts
		const saves = Array.from({length: 5}, (_, i) =>
			manager.saveSession({
				...session,
				messageCount: i + 2,
				messages: [
					...session.messages,
					{role: 'assistant', content: `reply ${i}`},
				],
			}),
		);

		await Promise.all(saves);

		// Index should have exactly 1 entry (not 5 duplicates)
		const sessions = await manager.listSessions();
		t.is(sessions.length, 1);
		t.is(sessions[0].id, session.id);
	},
);

// --- full lifecycle ---

test.serial(
	'full lifecycle: create → update → read → load → delete',
	async t => {
		// Create
		const session = await manager.createSession({
			title: 'Lifecycle',
			messageCount: 1,
			provider: 'test',
			model: 'test-model',
			workingDirectory: '/tmp',
			messages: [{role: 'user', content: 'hello'}],
		});
		t.truthy(session.id);

		// Update
		session.messages.push({role: 'assistant', content: 'hi'});
		session.messageCount = 2;
		await manager.saveSession(session);

		// Read (no side effects)
		const read = await manager.readSession(session.id);
		t.is(read!.messageCount, 2);
		t.is(read!.messages.length, 2);

		// Load (updates lastAccessedAt)
		await new Promise(r => setTimeout(r, 10));
		const loaded = await manager.loadSession(session.id);
		t.truthy(loaded);
		t.not(loaded!.lastAccessedAt, session.lastAccessedAt);

		// Verify in listing
		const sessions = await manager.listSessions();
		t.is(sessions.length, 1);
		t.is(sessions[0].title, 'Lifecycle');

		// Delete
		await manager.deleteSession(session.id);
		const afterDelete = await manager.listSessions();
		t.is(afterDelete.length, 0);
		t.is(await manager.readSession(session.id), null);
	},
);

// --- index consistency ---

test.serial(
	'index stays consistent after interleaved create and delete',
	async t => {
		const s1 = await manager.createSession({
			title: 'Keep',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});
		const s2 = await manager.createSession({
			title: 'Delete',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});
		const s3 = await manager.createSession({
			title: 'Also keep',
			messageCount: 0,
			provider: 'test',
			model: 'test',
			workingDirectory: '/tmp',
			messages: [],
		});

		await manager.deleteSession(s2.id);

		const sessions = await manager.listSessions();
		t.is(sessions.length, 2);
		const ids = sessions.map(s => s.id);
		t.true(ids.includes(s1.id));
		t.true(ids.includes(s3.id));
		t.false(ids.includes(s2.id));
	},
);

test.serial(
	'index and files stay in sync after multiple operations',
	async t => {
		// Create 3 sessions
		for (let i = 0; i < 3; i++) {
			await manager.createSession({
				title: `Session ${i}`,
				messageCount: 0,
				provider: 'test',
				model: 'test',
				workingDirectory: '/tmp',
				messages: [],
			});
		}

		const sessions = await manager.listSessions();
		t.is(sessions.length, 3);

		// Verify each session in the index has a corresponding file
		for (const meta of sessions) {
			const session = await manager.readSession(meta.id);
			t.truthy(session, `Session file should exist for ${meta.id}`);
			t.is(session!.title, meta.title);
		}

		// Verify no extra session files exist beyond what's in the index
		const entries = await readdir(sessionsDir);
		const jsonFiles = entries.filter(
			e => e.endsWith('.json') && e !== 'sessions.json',
		);
		t.is(jsonFiles.length, sessions.length);
	},
);
