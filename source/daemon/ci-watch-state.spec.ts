import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	getCiWatchStatePath,
	readCiWatchState,
	writeCiWatchState,
} from './ci-watch-state';

console.log('\nci-watch-state.spec.ts');

async function tempProject(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'ci-watch-state-'));
}

test('round-trips seenFailedRunIds through write then read', async t => {
	const root = await tempProject();
	try {
		await writeCiWatchState(root, {seenFailedRunIds: [1, 2, 3]});
		const state = await readCiWatchState(root);
		t.deepEqual(state, {seenFailedRunIds: [1, 2, 3]});
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('a missing state file reads as an empty default', async t => {
	const root = await tempProject();
	try {
		const state = await readCiWatchState(root);
		t.deepEqual(state, {seenFailedRunIds: []});
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('corrupt JSON reads as an empty default rather than throwing', async t => {
	const root = await tempProject();
	try {
		const path = getCiWatchStatePath(root);
		await mkdir(join(root, '.nanocoder'), {recursive: true});
		await writeFile(path, 'not json {{{', 'utf-8');
		const state = await readCiWatchState(root);
		t.deepEqual(state, {seenFailedRunIds: []});
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('a valid JSON file with a non-array seenFailedRunIds reads as an empty default', async t => {
	const root = await tempProject();
	try {
		const path = getCiWatchStatePath(root);
		await mkdir(join(root, '.nanocoder'), {recursive: true});
		await writeFile(path, JSON.stringify({seenFailedRunIds: 'nope'}), 'utf-8');
		const state = await readCiWatchState(root);
		t.deepEqual(state, {seenFailedRunIds: []});
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('writes merge into existing state so writers never clobber each other', async t => {
	const root = await tempProject();
	try {
		await writeCiWatchState(root, {seenFailedRunIds: [1, 2]});
		await writeCiWatchState(root, {autoFixedShas: ['abc']});
		await writeCiWatchState(root, {seenFailedRunIds: [1, 2, 3]});
		t.deepEqual(await readCiWatchState(root), {
			seenFailedRunIds: [1, 2, 3],
			autoFixedShas: ['abc'],
		});
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('a non-array autoFixedShas is dropped instead of breaking the read', async t => {
	const root = await tempProject();
	try {
		await mkdir(join(root, '.nanocoder'), {recursive: true});
		await writeFile(
			getCiWatchStatePath(root),
			JSON.stringify({seenFailedRunIds: [7], autoFixedShas: 'oops'}),
		);
		t.deepEqual(await readCiWatchState(root), {seenFailedRunIds: [7]});
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});
