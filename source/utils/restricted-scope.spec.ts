import test from 'ava';
import {isPathInScope, normalizeScopeEntry} from './restricted-scope';

test('normalizes the ways a scope can be written', t => {
	for (const entry of ['src/a', './src/a/', 'src/a/**', 'src\\a', 'src//a']) {
		t.is(normalizeScopeEntry(entry), 'src/a', entry);
	}
	t.is(normalizeScopeEntry('.'), '');
	t.is(normalizeScopeEntry('./**'), '');
});

test('matches whole path segments only', t => {
	t.true(isPathInScope('src/a', ['src/a']));
	t.true(isPathInScope('src/a/deep/file.ts', ['src/a']));
	t.false(isPathInScope('src/ab.ts', ['src/a']));
	t.false(isPathInScope('src', ['src/a']));
	t.true(isPathInScope('anything', ['']));
});

test('never matches a path outside the project', t => {
	t.false(isPathInScope('..', ['']));
	t.false(isPathInScope('../x', ['']));
	t.false(isPathInScope('/etc/passwd', ['']));
	t.true(isPathInScope('..notes', ['']));
});
