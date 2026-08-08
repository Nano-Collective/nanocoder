import test from 'ava';
import {ArtifactController} from './artifact-controller';

test('ArtifactController collects lifecycle artifacts and replaces them on resume', t => {
	const controller = new ArtifactController();
	controller.observeSessionUpdate({
		update: {
			sessionUpdate: 'tool_call_update',
			_meta: {
				'nanocoder/artifact': {
					kind: 'walkthrough',
					path: '/tmp/walkthrough.md',
				},
			},
		},
	});

	t.deepEqual(controller.artifacts, [
		{kind: 'walkthrough', path: '/tmp/walkthrough.md'},
	]);

	controller.replaceFromMeta({
		'nanocoder/artifacts': [
			{kind: 'task', path: '/tmp/task.md'},
			{kind: 'implementation_plan', path: '/tmp/implementation_plan.md'},
		],
	});

	t.deepEqual(controller.artifacts, [
		{kind: 'implementation_plan', path: '/tmp/implementation_plan.md'},
		{kind: 'task', path: '/tmp/task.md'},
	]);
});
