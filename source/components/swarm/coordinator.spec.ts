import test from 'ava';
import {TaskSchema, validateDisjointScopes} from './coordinator-utils';

test('TaskSchema: parses valid manifest', t => {
	const validManifest = {
		tasks: [
			{
				id: 'worker-1',
				description: 'Do something',
				fileScope: ['src/auth']
			},
			{
				id: 'worker-2',
				description: 'Do something else',
				fileScope: ['src/api']
			}
		]
	};

	const result = TaskSchema.safeParse(validManifest);
	t.true(result.success);
});

test('TaskSchema: rejects missing fileScope', t => {
	const invalidManifest = {
		tasks: [
			{
				id: 'worker-1',
				description: 'Do something',
			}
		]
	};

	const result = TaskSchema.safeParse(invalidManifest);
	t.false(result.success);
});

test('TaskSchema: allows empty fileScope', t => {
	const manifest = {
		tasks: [
			{
				id: 'worker-1',
				description: 'Read only task',
				fileScope: []
			}
		]
	};

	const result = TaskSchema.safeParse(manifest);
	t.true(result.success);
});

// validateDisjointScopes tests

test('validateDisjointScopes: returns null for mutually exclusive scopes', t => {
	const tasks = [
		{id: '1', description: 'a', fileScope: ['src/auth']},
		{id: '2', description: 'b', fileScope: ['src/api']}
	];
	t.is(validateDisjointScopes(tasks), null);
});

test('validateDisjointScopes: returns null for mutually exclusive files', t => {
	const tasks = [
		{id: '1', description: 'a', fileScope: ['src/utils/a.ts']},
		{id: '2', description: 'b', fileScope: ['src/utils/b.ts']}
	];
	t.is(validateDisjointScopes(tasks), null);
});

test('validateDisjointScopes: returns error on exact match', t => {
	const tasks = [
		{id: '1', description: 'a', fileScope: ['src/auth']},
		{id: '2', description: 'b', fileScope: ['src/auth']}
	];
	const err = validateDisjointScopes(tasks);
	t.truthy(err);
	t.regex(err!, /Overlap detected/);
});

test('validateDisjointScopes: returns error when one scope contains another', t => {
	const tasks = [
		{id: '1', description: 'a', fileScope: ['src']},
		{id: '2', description: 'b', fileScope: ['src/auth']}
	];
	const err = validateDisjointScopes(tasks);
	t.truthy(err);
	t.regex(err!, /Overlap detected/);
});

test('validateDisjointScopes: returns error regardless of array order', t => {
	const tasks = [
		{id: '1', description: 'a', fileScope: ['src/auth']},
		{id: '2', description: 'b', fileScope: ['src']}
	];
	const err = validateDisjointScopes(tasks);
	t.truthy(err);
	t.regex(err!, /Overlap detected/);
});

test('validateDisjointScopes: normalizes paths to detect overlap', t => {
	const tasks = [
		{id: '1', description: 'a', fileScope: ['src/auth/./']},
		{id: '2', description: 'b', fileScope: ['src/auth']}
	];
	const err = validateDisjointScopes(tasks);
	t.truthy(err);
	t.regex(err!, /Overlap detected/);
});
