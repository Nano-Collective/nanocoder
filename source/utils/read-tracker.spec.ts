import {resolve} from 'node:path';
import test from 'ava';
import {clearReadTracker, hasSeenFile, markFileSeen} from './read-tracker.js';

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
