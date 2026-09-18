import {resolve} from 'node:path';
import test from 'ava';
import {
	bumpReadContentGeneration,
	clearReadTracker,
	forgetReadContent,
	hasSeenFile,
	markFileSeen,
	matchReadContent,
	rememberReadContent,
	runWithReadContentScope,
	clearReadContentScope,
} from './read-tracker.js';

test.beforeEach(() => {
	clearReadTracker();
});

test.serial('hasSeenFile is false for an unseen file', t => {
	t.false(hasSeenFile('/tmp/never-read.txt'));
});

test.serial('markFileSeen makes a file seen', t => {
	markFileSeen('/tmp/read-me.txt');
	t.true(hasSeenFile('/tmp/read-me.txt'));
});

test.serial('paths are normalized so relative and absolute match', t => {
	const abs = resolve('relative/path.txt');
	markFileSeen('relative/path.txt');
	t.true(hasSeenFile(abs));
});

test.serial('clearReadTracker forgets all seen files', t => {
	markFileSeen('/tmp/a.txt');
	markFileSeen('/tmp/b.txt');
	clearReadTracker();
	t.false(hasSeenFile('/tmp/a.txt'));
	t.false(hasSeenFile('/tmp/b.txt'));
});

test.serial('matchReadContent hits the same path and range', t => {
	const stats = {mtimeMs: 10, size: 4};
	rememberReadContent('/tmp/stub.txt', stats, 2);
	t.deepEqual(matchReadContent('/tmp/stub.txt', stats), {
		lineCount: 2,
		size: 4,
	});
});

test.serial('matchReadContent misses after generation bump', t => {
	const stats = {mtimeMs: 10, size: 4};
	rememberReadContent('/tmp/stub.txt', stats, 2);
	bumpReadContentGeneration();
	t.is(matchReadContent('/tmp/stub.txt', stats), undefined);
});

test.serial('matchReadContent misses after size change', t => {
	rememberReadContent('/tmp/stub.txt', {mtimeMs: 10, size: 4}, 2);
	t.is(matchReadContent('/tmp/stub.txt', {mtimeMs: 10, size: 8}), undefined);
});

test.serial('forgetReadContent drops every range for that path', t => {
	const stats = {mtimeMs: 10, size: 4};
	rememberReadContent('/tmp/stub.txt', stats, 2);
	rememberReadContent('/tmp/stub.txt', stats, 2, 1, 2);
	forgetReadContent('/tmp/stub.txt');
	t.is(matchReadContent('/tmp/stub.txt', stats), undefined);
	t.is(matchReadContent('/tmp/stub.txt', stats, 1, 2), undefined);
});

test.serial('clearReadTracker drops stub state too', t => {
	const stats = {mtimeMs: 10, size: 4};
	rememberReadContent('/tmp/stub.txt', stats, 2);
	clearReadTracker();
	t.is(matchReadContent('/tmp/stub.txt', stats), undefined);
});

test.serial('read content scopes do not leak across runWithReadContentScope', t => {
	const stats = {mtimeMs: 10, size: 4};
	rememberReadContent('/tmp/stub.txt', stats, 2);
	runWithReadContentScope('subagent', () => {
		t.is(matchReadContent('/tmp/stub.txt', stats), undefined);
		rememberReadContent('/tmp/stub.txt', stats, 2);
	});
	t.deepEqual(matchReadContent('/tmp/stub.txt', stats), {
		lineCount: 2,
		size: 4,
	});
});

test.serial('bumpReadContentGeneration does not clear the edit guard', t => {
	markFileSeen('/tmp/seen.txt');
	bumpReadContentGeneration();
	t.true(hasSeenFile('/tmp/seen.txt'));
});

test.serial('clearReadContentScope drops only that scope', t => {
	const stats = {mtimeMs: 10, size: 4};
	rememberReadContent('/tmp/main.txt', stats, 2);
	runWithReadContentScope('agent-1', () => {
		rememberReadContent('/tmp/sub.txt', stats, 2);
	});
	clearReadContentScope('agent-1');
	t.deepEqual(matchReadContent('/tmp/main.txt', stats), {
		lineCount: 2,
		size: 4,
	});
	runWithReadContentScope('agent-1', () => {
		t.is(matchReadContent('/tmp/sub.txt', stats), undefined);
	});
});
