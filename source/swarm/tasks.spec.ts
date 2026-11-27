import test from 'ava';
import {TaskSchema, validateDisjointScopes} from './tasks';

const task = (id: string, ...fileScope: string[]) => ({
	id,
	description: 'work',
	fileScope,
});

test('accepts relative paths and normalizes them', t => {
	const {tasks} = TaskSchema.parse({tasks: [task('a', './src/a/**')]});
	t.deepEqual(tasks[0]?.fileScope, ['src/a']);
});

test('rejects unusable plans', t => {
	const rejected = [
		[],
		[task('a')],
		[task('a', '')],
		[task('a', '/etc')],
		[task('a', 'C:\\temp')],
		[task('a', '../outside')],
		[task('a', 'src/../../outside')],
		[task('a', 'src/*.ts')],
		[task('a', 'src/a,src/b')],
		[task('../a', 'src')],
		[task('A b', 'src')],
		[task('a'.repeat(41), 'src')],
		[{id: 'a', description: '  ', fileScope: ['src']}],
	];
	for (const tasks of rejected) {
		t.false(TaskSchema.safeParse({tasks}).success, JSON.stringify(tasks));
	}
});

test('detects overlapping scopes', t => {
	const overlap = (a: string, b: string) =>
		validateDisjointScopes([task('a', a), task('b', b)]);
	t.truthy(overlap('src', 'src/b'));
	t.truthy(overlap('src/b', 'src'));
	t.truthy(overlap('src/A.ts', 'src/a.ts'));
	t.truthy(overlap('', 'docs'));
	t.is(overlap('src/a', 'src/ab'), null);
});

test('detects duplicate ids', t => {
	t.regex(
		validateDisjointScopes([task('a', 'x'), task('a', 'y')]) ?? '',
		/Duplicate task id/,
	);
});
