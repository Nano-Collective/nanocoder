import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {ArtifactManager} from '@/artifacts/artifact-manager';
import {createWriteTasksTool} from './write-tasks';

test('write_tasks persists and returns the current session task list', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-write-tasks-'));
	const artifacts = new ArtifactManager(root);
	const sessionId = '11111111-1111-4111-8111-111111111111';
	const writeTasks = createWriteTasksTool(artifacts);

	try {
		const result = await writeTasks.tool.execute!(
			{
				tasks: [
					{title: 'Inspect parser', status: 'in_progress'},
					{title: 'Add tests', status: 'pending'},
				],
			},
			{toolCallId: 'tasks', messages: [], sessionId} as never,
		);

		t.is(typeof result, 'object');
		if (typeof result === 'object' && result && 'structured' in result) {
			const structured = result.structured as {tasks: Array<{title: string}>};
			t.deepEqual(
				structured.tasks.map(task => task.title),
				['Inspect parser', 'Add tests'],
			);
		}
		t.truthy(await artifacts.readArtifact(sessionId, 'task'));
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});
