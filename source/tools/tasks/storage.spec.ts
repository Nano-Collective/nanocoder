import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {ArtifactManager} from '@/artifacts/artifact-manager';
import {setCliSessionId} from '@/session/cli-session-context';
import {
	clearAllTasks,
	generateTaskId,
	getTasksPath,
	loadTasks,
	saveTasks,
} from './storage.js';
import type {Task} from './types.js';

// ============================================================================
// Task Storage Tests
// ============================================================================
// Task state is session-scoped and lives with the session's artifacts. There
// is no `.nanocoder/tasks.json` in the working directory any more, so these
// tests never touch (or need to fake) process.cwd().

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';

async function withArtifacts(
	run: (artifacts: ArtifactManager, root: string) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-task-storage-'));
	try {
		await run(new ArtifactManager(root), root);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
}

function task(overrides: Partial<Task> = {}): Task {
	const now = '2026-08-07T00:00:00.000Z';
	return {
		id: generateTaskId(),
		title: 'Inspect parser',
		status: 'pending',
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

// ============================================================================
// generateTaskId
// ============================================================================

test('generateTaskId - generates 8-character string', t => {
	t.is(generateTaskId().length, 8);
});

test('generateTaskId - generates unique IDs', t => {
	const ids = new Set<string>();
	for (let i = 0; i < 100; i++) ids.add(generateTaskId());
	t.is(ids.size, 100);
});

test('generateTaskId - generates valid UUID prefix format', t => {
	t.regex(generateTaskId(), /^[a-f0-9]{8}$/);
});

// ============================================================================
// getTasksPath
// ============================================================================

test('getTasksPath - resolves inside the session artifact directory', async t => {
	await withArtifacts(async (artifacts, root) => {
		const path = getTasksPath(SESSION_A, artifacts);
		t.is(path, join(root, SESSION_A, 'tasks.json'));
	});
});

test('getTasksPath - returns null when no session can be resolved', async t => {
	await withArtifacts(async artifacts => {
		setCliSessionId(null);
		t.is(getTasksPath(undefined, artifacts), null);
	});
});

// ============================================================================
// Session scoping
// ============================================================================

test('session tasks persist as isolated JSON and Markdown artifacts', async t => {
	await withArtifacts(async artifacts => {
		const tasks: Task[] = [
			task({title: 'Inspect parser', status: 'in_progress'}),
			task({
				title: 'Add tests',
				description: 'Cover resume behavior',
				status: 'completed',
				completedAt: '2026-08-07T00:00:00.000Z',
			}),
		];

		await saveTasks(tasks, SESSION_A, artifacts);
		await saveTasks([], SESSION_B, artifacts);

		t.deepEqual(await loadTasks(SESSION_A, artifacts), tasks);
		t.deepEqual(await loadTasks(SESSION_B, artifacts), []);

		const markdown = await artifacts.readArtifact(SESSION_A, 'task');
		t.true(markdown?.includes('- [ ] **In progress:** Inspect parser'));
		t.true(markdown?.includes('- [x] Add tests'));
		t.true(markdown?.includes('Cover resume behavior'));
	});
});

test('task commands use the active CLI session when no ID is passed', async t => {
	await withArtifacts(async artifacts => {
		const tasks = [task({title: 'CLI task'})];
		try {
			setCliSessionId(SESSION_A);
			await saveTasks(tasks, undefined, artifacts);
			t.deepEqual(await loadTasks(undefined, artifacts), tasks);
			t.truthy(await artifacts.readArtifact(SESSION_A, 'task'));
		} finally {
			setCliSessionId(null);
		}
	});
});

// ============================================================================
// No working-directory fallback
// ============================================================================

test('saveTasks writes nothing anywhere when there is no session', async t => {
	await withArtifacts(async (artifacts, root) => {
		setCliSessionId(null);
		await saveTasks([task()], undefined, artifacts);
		t.deepEqual(
			await readdir(root),
			[],
			'a sessionless save must not create an artifact directory',
		);
	});
});

test('loadTasks returns empty when there is no session', async t => {
	await withArtifacts(async artifacts => {
		setCliSessionId(null);
		t.deepEqual(await loadTasks(undefined, artifacts), []);
	});
});

// ============================================================================
// loadTasks
// ============================================================================

test('loadTasks - returns empty array when the session has no tasks yet', async t => {
	await withArtifacts(async artifacts => {
		t.deepEqual(await loadTasks(SESSION_A, artifacts), []);
	});
});

test('loadTasks - loads previously saved tasks', async t => {
	await withArtifacts(async artifacts => {
		const tasks = [task({title: 'Persisted'})];
		await saveTasks(tasks, SESSION_A, artifacts);
		t.deepEqual(await loadTasks(SESSION_A, artifacts), tasks);
	});
});

test('loadTasks - returns empty array on invalid JSON', async t => {
	await withArtifacts(async artifacts => {
		await artifacts.writeArtifact(SESSION_A, 'tasks', 'not json at all');
		t.deepEqual(await loadTasks(SESSION_A, artifacts), []);
	});
});

test('loadTasks - returns empty array when the payload is not an array', async t => {
	await withArtifacts(async artifacts => {
		await artifacts.writeArtifact(SESSION_A, 'tasks', '{"tasks": []}');
		t.deepEqual(await loadTasks(SESSION_A, artifacts), []);
	});
});

// ============================================================================
// saveTasks
// ============================================================================

test('saveTasks - overwrites the previous list', async t => {
	await withArtifacts(async artifacts => {
		await saveTasks([task({title: 'First'})], SESSION_A, artifacts);
		await saveTasks([task({title: 'Second'})], SESSION_A, artifacts);

		const loaded = await loadTasks(SESSION_A, artifacts);
		t.is(loaded.length, 1);
		t.is(loaded[0]?.title, 'Second');
	});
});

test('saveTasks - saves with pretty formatting', async t => {
	await withArtifacts(async artifacts => {
		await saveTasks([task()], SESSION_A, artifacts);
		const raw = await artifacts.readArtifact(SESSION_A, 'tasks');
		t.true(raw?.includes('\n  '), 'JSON should be indented');
	});
});

// ============================================================================
// clearAllTasks
// ============================================================================

test('clearAllTasks - clears existing tasks', async t => {
	await withArtifacts(async artifacts => {
		await saveTasks([task(), task({title: 'Second'})], SESSION_A, artifacts);
		await clearAllTasks(SESSION_A, artifacts);
		t.deepEqual(await loadTasks(SESSION_A, artifacts), []);
	});
});

test('clearAllTasks - works when no tasks exist', async t => {
	await withArtifacts(async artifacts => {
		await t.notThrowsAsync(clearAllTasks(SESSION_A, artifacts));
		t.deepEqual(await loadTasks(SESSION_A, artifacts), []);
	});
});

// ============================================================================
// Lifecycle
// ============================================================================

test('storage - full lifecycle: create, update, clear', async t => {
	await withArtifacts(async artifacts => {
		const first = task({title: 'Write the parser'});
		await saveTasks([first], SESSION_A, artifacts);
		t.is((await loadTasks(SESSION_A, artifacts)).length, 1);

		const updated: Task = {...first, status: 'completed'};
		await saveTasks([updated], SESSION_A, artifacts);
		t.is((await loadTasks(SESSION_A, artifacts))[0]?.status, 'completed');

		const markdown = await artifacts.readArtifact(SESSION_A, 'task');
		t.true(markdown?.includes('- [x] Write the parser'));

		await clearAllTasks(SESSION_A, artifacts);
		t.deepEqual(await loadTasks(SESSION_A, artifacts), []);
	});
});
