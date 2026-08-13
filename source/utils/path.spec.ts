import test from 'ava';
import {resolve, sep} from 'node:path';
import {homeRelative} from './path.js';

const HOME = resolve('/Users/will');

test('homeRelative shortens a path inside home to a tilde form', t => {
	const input = resolve('/Users/will/projects/app');
	t.is(homeRelative(input, HOME), `~${sep}projects${sep}app`);
});

test('homeRelative returns a bare tilde for the home directory itself', t => {
	t.is(homeRelative(resolve('/Users/will'), HOME), '~');
});

test('homeRelative does not mangle a sibling directory that shares a prefix', t => {
	const input = resolve('/Users/willy/projects/app');
	t.is(homeRelative(input, HOME), input);
});

test('homeRelative leaves unrelated paths untouched', t => {
	const input = resolve('/etc/config');
	t.is(homeRelative(input, HOME), input);
});

test('homeRelative leaves paths untouched when home is the filesystem root', t => {
	const root = resolve('/');
	const child = resolve('/foo');
	t.is(homeRelative(child, root), child);
	t.is(homeRelative(root, root), root);
});
