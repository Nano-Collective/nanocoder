import {execSync} from 'node:child_process';
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {getAppConfig} from '../config/index';
import type {LLMClient} from '../types/core';
import {
	cleanMessage,
	maybeAutoCommit,
	setAutoCommitClient,
} from './auto-commit';

test.serial.beforeEach(() => {
	getAppConfig().autoCommit = true;
	setAutoCommitClient(null);
});

test.serial.afterEach.always(() => {
	getAppConfig().autoCommit = false;
	setAutoCommitClient(null);
});

function git(dir: string, command: string): string {
	return execSync(`git ${command}`, {cwd: dir, encoding: 'utf8'}).trimEnd();
}

/** A repo with one committed file, isolated from the machine's git setup. */
function makeRepo(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'auto-commit-')));
	git(dir, 'init -q -b main');
	git(dir, 'config user.email test@example.com');
	git(dir, 'config user.name Test');
	git(dir, 'config commit.gpgsign false');
	git(dir, 'config core.autocrlf false');
	git(dir, 'config core.hooksPath .no-hooks');
	writeFileSync(join(dir, 'base.txt'), 'base\n');
	git(dir, 'add base.txt');
	git(dir, 'commit -q -m baseline');
	return dir;
}

function commitCount(dir: string): number {
	return Number(git(dir, 'rev-list --count HEAD'));
}

function fakeClient(chat: () => Promise<unknown>): LLMClient {
	return {chat} as unknown as LLMClient;
}

function replying(content: string): LLMClient {
	return fakeClient(async () => ({choices: [{message: {content}}]}));
}

test.serial('does nothing when nanocoder.autoCommit is off', async t => {
	const dir = makeRepo();
	try {
		getAppConfig().autoCommit = false;
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'export const a = 1;\n');
		t.is(await maybeAutoCommit('write_file', {path: file}), null);
		t.is(commitCount(dir), 1);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('commits the edited file with the generated message', async t => {
	const dir = makeRepo();
	try {
		setAutoCommitClient(replying('feat: add a constant'));
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'export const a = 1;\n');

		const note = await maybeAutoCommit('write_file', {path: file});

		t.regex(note ?? '', /^\[auto-commit\] [a-f0-9]{7,} feat: add a constant$/);
		t.is(commitCount(dir), 2);
		t.is(git(dir, 'log -1 --format=%s'), 'feat: add a constant');
		t.is(git(dir, 'show --name-only --format= HEAD'), 'a.ts');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial("leaves the user's other changes out of the commit", async t => {
	const dir = makeRepo();
	try {
		// The user has a staged new file and an unstaged edit of their own.
		writeFileSync(join(dir, 'staged.txt'), 'mine\n');
		git(dir, 'add staged.txt');
		writeFileSync(join(dir, 'base.txt'), 'user edit\n');

		const file = join(dir, 'agent.ts');
		writeFileSync(file, 'export {};\n');
		await maybeAutoCommit('string_replace', {path: file});

		t.is(git(dir, 'show --name-only --format= HEAD'), 'agent.ts');
		const status = git(dir, 'status --porcelain');
		t.true(status.includes('A  staged.txt'), status);
		t.true(status.includes(' M base.txt'), status);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('ignores tools that do not edit files', async t => {
	const dir = makeRepo();
	try {
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'x\n');
		t.is(await maybeAutoCommit('read_file', {path: file}), null);
		t.is(commitCount(dir), 1);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('skips an edit that left the file unchanged', async t => {
	const dir = makeRepo();
	try {
		t.is(
			await maybeAutoCommit('write_file', {path: join(dir, 'base.txt')}),
			null,
		);
		t.is(commitCount(dir), 1);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('falls back to a plain message when the model fails', async t => {
	const dir = makeRepo();
	try {
		setAutoCommitClient(
			fakeClient(async () => {
				throw new Error('provider down');
			}),
		);
		const file = join(dir, 'src.ts');
		writeFileSync(file, 'x\n');
		await maybeAutoCommit('diff_edit', {path: file});
		t.is(git(dir, 'log -1 --format=%s'), 'chore: update src.ts');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial(
	'falls back to a plain message when there is no client',
	async t => {
		const dir = makeRepo();
		try {
			const file = join(dir, 'b.ts');
			writeFileSync(file, 'x\n');
			await maybeAutoCommit('write_file', {path: file});
			t.is(git(dir, 'log -1 --format=%s'), 'chore: update b.ts');
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial('resolves a relative path against the session cwd', async t => {
	const dir = makeRepo();
	const {setSessionCwd, resetSessionCwd} = await import('./session-cwd');
	try {
		setSessionCwd(dir);
		writeFileSync(join(dir, 'rel.ts'), 'x\n');
		await maybeAutoCommit('write_file', {path: 'rel.ts'});
		t.is(git(dir, 'show --name-only --format= HEAD'), 'rel.ts');
	} finally {
		resetSessionCwd();
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('returns null outside a git repository', async t => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'auto-commit-norepo-')));
	try {
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'x\n');
		t.is(await maybeAutoCommit('write_file', {path: file}), null);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('skips ignored files', async t => {
	const dir = makeRepo();
	try {
		writeFileSync(join(dir, '.gitignore'), 'dist/\n');
		git(dir, 'add .gitignore');
		git(dir, 'commit -q -m ignore');
		execSync('mkdir dist', {cwd: dir});
		const file = join(dir, 'dist', 'out.js');
		writeFileSync(file, 'x\n');
		t.is(await maybeAutoCommit('write_file', {path: file}), null);
		t.is(commitCount(dir), 2);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('skips while a merge is in progress', async t => {
	const dir = makeRepo();
	try {
		writeFileSync(
			join(dir, '.git', 'MERGE_HEAD'),
			`${git(dir, 'rev-parse HEAD')}\n`,
		);
		const file = join(dir, 'a.ts');
		writeFileSync(file, 'x\n');
		t.is(await maybeAutoCommit('write_file', {path: file}), null);
		t.is(commitCount(dir), 1);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('serializes concurrent edits into separate commits', async t => {
	const dir = makeRepo();
	try {
		const files = ['one.ts', 'two.ts', 'three.ts'].map(name => {
			const file = join(dir, name);
			writeFileSync(file, `${name}\n`);
			return file;
		});
		const notes = await Promise.all(
			files.map(file => maybeAutoCommit('write_file', {path: file})),
		);
		t.true(notes.every(note => note?.startsWith('[auto-commit]')));
		t.is(commitCount(dir), 4);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('commits what a post-tool-use formatter hook wrote', async t => {
	const dir = makeRepo();
	const config = getAppConfig();
	const previousHooks = config.hooks;
	const {processToolUse, setToolRegistryGetter} = await import(
		'../message-handler'
	);
	try {
		// Stands in for `prettier --write "$NANOCODER_FILE"`.
		config.hooks = {
			'post-tool-use': [
				{
					command: `node -e "require('fs').appendFileSync(process.env.NANOCODER_FILE, 'formatted\\n')"`,
				},
			],
		};
		setToolRegistryGetter(() => ({
			write_file: async (args: Record<string, unknown>) => {
				writeFileSync(String(args.path), 'agent\n');
				return 'File written.';
			},
		}));
		const file = join(dir, 'fmt.ts');

		const result = await processToolUse({
			id: 'call-1',
			function: {name: 'write_file', arguments: {path: file}},
		});

		t.regex(String(result.content), /\[auto-commit\] [a-f0-9]{7,} /);
		t.is(git(dir, 'show HEAD:fmt.ts'), 'agent\nformatted');
		t.is(git(dir, 'status --porcelain'), '');
	} finally {
		config.hooks = previousHooks;
		setToolRegistryGetter(() => ({}));
		rmSync(dir, {recursive: true, force: true});
	}
});

test('cleanMessage strips a code fence around the message', t => {
	t.is(cleanMessage('```\nfix: thing\n```'), 'fix: thing');
	t.is(cleanMessage('```text\nfeat: x\n\nbody\n```'), 'feat: x\n\nbody');
	t.is(cleanMessage('  docs: y  '), 'docs: y');
	t.is(cleanMessage(undefined), '');
});
