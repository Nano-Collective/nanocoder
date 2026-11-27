import test from 'ava';
import {isNewerVersion} from './version-compare';

test('compares major, minor and patch versions numerically', t => {
	t.true(isNewerVersion('1.9.9', '2.0.0'));
	t.true(isNewerVersion('1.9.9', '1.10.0'));
	t.true(isNewerVersion('1.2.9', '1.2.10'));
	t.false(isNewerVersion('2.0.0', '1.9.9'));
	t.false(isNewerVersion('1.2.3', '1.2.3'));
});

test('accepts a leading v and compares extra numeric segments', t => {
	t.true(isNewerVersion('1.2.3', 'v1.2.4'));
	t.true(isNewerVersion('1.2.3', '1.2.3.1'));
});

test('stable release is newer than a prerelease with the same numeric version', t => {
	t.true(isNewerVersion('1.2.3-beta.1', '1.2.3'));
	t.false(isNewerVersion('1.2.3', '1.2.3-beta.1'));
});

test('compares prerelease identifiers in semver precedence order', t => {
	t.true(isNewerVersion('1.2.3-alpha', '1.2.3-alpha.1'));
	t.true(isNewerVersion('1.2.3-alpha.1', '1.2.3-alpha.beta'));
	t.true(isNewerVersion('1.2.3-alpha.beta', '1.2.3-beta'));
	t.true(isNewerVersion('1.2.3-1', '1.2.3-alpha'));
	t.false(isNewerVersion('1.2.3-alpha.1', '1.2.3-alpha'));
	t.false(isNewerVersion('1.2.3-beta', '1.2.3-alpha.beta'));
});

test('ignores build metadata', t => {
	t.false(isNewerVersion('1.2.3+build.1', '1.2.3+build.2'));
	t.true(isNewerVersion('1.2.3-beta+build.1', '1.2.3+build.2'));
});
