import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'ava';
import {
	getSafeSessionCwd,
	getSessionCwd,
	resetSessionCwd,
	setSessionCwd,
} from './session-cwd.js';

console.log('\nservices/session-cwd.spec.ts');

test.serial('defaults to the process launch directory', t => {
	resetSessionCwd();
	t.is(getSessionCwd(), process.cwd());
});

test.serial('setSessionCwd stores an absolute path; blank input is ignored', t => {
	resetSessionCwd();
	const dir = mkdtempSync(join(tmpdir(), 'nc-cwd-'));
	try {
		setSessionCwd(dir);
		t.is(getSessionCwd(), resolve(dir));
		setSessionCwd('   ');
		t.is(getSessionCwd(), resolve(dir), 'blank input must not clobber the cwd');
	} finally {
		resetSessionCwd();
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('getSafeSessionCwd recovers when the stored dir was removed', t => {
	resetSessionCwd();
	const dir = mkdtempSync(join(tmpdir(), 'nc-cwd-'));
	setSessionCwd(dir);
	rmSync(dir, {recursive: true, force: true}); // e.g. a torn-down worktree
	t.is(getSafeSessionCwd(), process.cwd());
	t.is(getSessionCwd(), process.cwd(), 'recovery also updates the stored value');
});
