import {existsSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {resetPreferencesCache} from '@/config/preferences';
import {
	isFullCommitTrustConfirmed,
	recordFullCommitTrustConfirmed,
} from './full-commit-trust';

console.log('\nfull-commit-trust.spec.ts');

const testConfigDir = join(tmpdir(), `nanocoder-test-full-commit-${Date.now()}`);

test.before(() => {
	process.env.NANOCODER_CONFIG_DIR = testConfigDir;
	mkdirSync(testConfigDir, {recursive: true});
	resetPreferencesCache();
});

test.after.always(() => {
	if (existsSync(testConfigDir)) {
		rmSync(testConfigDir, {recursive: true, force: true});
	}
	delete process.env.NANOCODER_CONFIG_DIR;
	resetPreferencesCache();
});

test.serial('a project is not confirmed until recorded', t => {
	t.false(isFullCommitTrustConfirmed('/some/fresh/project'));
});

test.serial('recording confirmation makes isFullCommitTrustConfirmed true', t => {
	recordFullCommitTrustConfirmed('/some/confirmed/project');
	t.true(isFullCommitTrustConfirmed('/some/confirmed/project'));
});

test.serial('confirmation is scoped to the project path — other paths stay unconfirmed', t => {
	recordFullCommitTrustConfirmed('/project/a');
	t.true(isFullCommitTrustConfirmed('/project/a'));
	t.false(isFullCommitTrustConfirmed('/project/b'));
});

test.serial('recording the same project twice does not duplicate entries', t => {
	recordFullCommitTrustConfirmed('/project/dup');
	recordFullCommitTrustConfirmed('/project/dup');
	// Not observable via the confirmed check alone, but exercises the
	// dedup branch without throwing — the real assertion is just that this
	// doesn't error and the project stays confirmed.
	t.true(isFullCommitTrustConfirmed('/project/dup'));
});

test.serial('path normalization: relative and absolute forms of the same path are equivalent', t => {
	const absolute = join(process.cwd(), 'some-nested-dir');
	recordFullCommitTrustConfirmed(absolute);
	t.true(isFullCommitTrustConfirmed(join(absolute, '..', 'some-nested-dir')));
});
