import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'ava';
import {
	createSessionCwdScope,
	getContainedSessionCwd,
	getProjectRoot,
	getSafeSessionCwd,
	getSessionCwd,
	resetSessionCwd,
	runInSessionCwdScope,
	setProjectRoot,
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

test.serial(
	'getContainedSessionCwd clamps a session cwd outside the project to the root',
	t => {
		resetSessionCwd();
		const root = mkdtempSync(join(tmpdir(), 'nc-root-'));
		const inside = join(root, 'sub');
		mkdirSync(inside);
		const outside = mkdtempSync(join(tmpdir(), 'nc-out-'));
		try {
			setProjectRoot(root);
			setSessionCwd(inside);
			t.is(getContainedSessionCwd(), resolve(inside), 'a cwd inside is kept');
			setSessionCwd(outside);
			t.is(
				getContainedSessionCwd(),
				resolve(root),
				'a cwd outside falls back to the project root',
			);
		} finally {
			resetSessionCwd();
			rmSync(root, {recursive: true, force: true});
			rmSync(outside, {recursive: true, force: true});
		}
	},
);

test.serial('getSafeSessionCwd recovers when the stored dir was removed', t => {
	resetSessionCwd();
	const dir = mkdtempSync(join(tmpdir(), 'nc-cwd-'));
	setSessionCwd(dir);
	rmSync(dir, {recursive: true, force: true}); // e.g. a torn-down worktree
	t.is(getSafeSessionCwd(), process.cwd());
	t.is(getSessionCwd(), process.cwd(), 'recovery also updates the stored value');
});

// ============================================================================
// Session scopes (#1707): an ACP session's tools follow the `cwd` the client
// named for it, not the directory the agent process was spawned in.
// ============================================================================

test.serial('a session scope supplies its own root and cwd', t => {
	resetSessionCwd();
	const root = mkdtempSync(join(tmpdir(), 'nc-scope-'));
	try {
		const scope = createSessionCwdScope(root);
		runInSessionCwdScope(scope, () => {
			t.is(getProjectRoot(), resolve(root));
			t.is(getSessionCwd(), resolve(root));
			t.is(getSafeSessionCwd(), resolve(root));
		});
		t.is(getSessionCwd(), process.cwd(), 'nothing leaks outside the scope');
		t.is(getProjectRoot(), resolve(process.cwd()));
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test.serial('a cd inside a scope moves only that scope, and persists', t => {
	resetSessionCwd();
	const root = mkdtempSync(join(tmpdir(), 'nc-scope-'));
	const sub = join(root, 'sub');
	mkdirSync(sub);
	try {
		const scope = createSessionCwdScope(root);
		runInSessionCwdScope(scope, () => setSessionCwd(sub));
		t.is(getSessionCwd(), process.cwd(), 'the process-wide cwd is untouched');
		runInSessionCwdScope(scope, () => {
			t.is(getSessionCwd(), resolve(sub), 'a later turn sees the cd');
			t.is(getProjectRoot(), resolve(root), 'the boundary does not move');
		});
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test.serial('concurrent scopes do not see each other', async t => {
	resetSessionCwd();
	const a = mkdtempSync(join(tmpdir(), 'nc-scope-a-'));
	const b = mkdtempSync(join(tmpdir(), 'nc-scope-b-'));
	try {
		const seen = await Promise.all(
			[a, b].map(dir =>
				runInSessionCwdScope(createSessionCwdScope(dir), async () => {
					await new Promise(resolveWait => setTimeout(resolveWait, 10));
					return getSessionCwd();
				}),
			),
		);
		t.deepEqual(seen, [resolve(a), resolve(b)]);
	} finally {
		rmSync(a, {recursive: true, force: true});
		rmSync(b, {recursive: true, force: true});
	}
});

test.serial('a removed cd target falls back to the scope root, not the process cwd', t => {
	resetSessionCwd();
	const root = mkdtempSync(join(tmpdir(), 'nc-scope-'));
	const sub = join(root, 'sub');
	mkdirSync(sub);
	try {
		const scope = createSessionCwdScope(root);
		runInSessionCwdScope(scope, () => {
			setSessionCwd(sub);
			rmSync(sub, {recursive: true, force: true});
			t.is(getSafeSessionCwd(), resolve(root));
			t.is(getSessionCwd(), resolve(root));
		});
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});
