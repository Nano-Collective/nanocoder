import test from 'ava';
import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {ensureNanocoderGitignore} from './ensure-nanocoder-gitignore';

test('creates gitignore and ignores runtime files but not configuration', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nanocoder-ignore-'));

	try {
		execFileSync('git', ['init', '-q'], {cwd: root});

		await ensureNanocoderGitignore(root);

		const nanocoderDir = path.join(root, '.nanocoder');

		const content = await fs.readFile(
			path.join(nanocoderDir, '.gitignore'),
			'utf8',
		);

		t.true(content.includes('/checkpoints/'));
		t.true(content.includes('/plans/'));
		t.true(content.includes('/timeline/'));
		t.true(content.includes('/daemon.*'));
		t.true(content.includes('/ci-watch-state.json*'));

		const ignoredPaths = [
			'.nanocoder/checkpoints/test/conversation.json',
			'.nanocoder/plans/auth.jsonl',
			'.nanocoder/plans/index.json',
			'.nanocoder/timeline/session/index.json',
			'.nanocoder/daemon.log',
			'.nanocoder/daemon.json',
			'.nanocoder/daemon.json.abc123.tmp',
			'.nanocoder/ci-watch-state.json',
			'.nanocoder/ci-watch-state.json.abc123.tmp',
		];

		for (const file of ignoredPaths) {
			const result = execFileSync(
				'git',
				['check-ignore', '-q', file],
				{cwd: root, encoding: 'utf8'},
			);

			t.is(result, '');
		}

		const configurationPaths = [
			'.nanocoder/commands/review.md',
			'.nanocoder/agents/helper.md',
			'.nanocoder/tools/example.ts',
			'.nanocoder/skills/example.md',
			'.nanocoder/plugins/example.ts',
		];

		for (const file of configurationPaths) {
			let ignored = false;

			try {
				execFileSync('git', ['check-ignore', '-q', file], {
					cwd: root,
					stdio: 'ignore',
				});
				ignored = true;
			} catch {
				// Exit code 1 means Git does not ignore the file.
			}

			t.false(ignored, `${file} should remain trackable`);
		}
	} finally {
		await fs.rm(root, {recursive: true, force: true});
	}
});

test('preserves existing rules and does not add duplicates', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nanocoder-ignore-'));

	try {
		const nanocoderDir = path.join(root, '.nanocoder');
		await fs.mkdir(nanocoderDir, {recursive: true});

		const gitignorePath = path.join(nanocoderDir, '.gitignore');

		await fs.writeFile(gitignorePath, 'custom-cache/\n/checkpoints/\n');

		await ensureNanocoderGitignore(root);
		const first = await fs.readFile(gitignorePath, 'utf8');

		await ensureNanocoderGitignore(root);
		const second = await fs.readFile(gitignorePath, 'utf8');

		t.is(first, second);
		t.true(second.includes('custom-cache/'));

		t.is(
			second.split('\n').filter(line => line === '/checkpoints/').length,
			1,
		);
	} finally {
		await fs.rm(root, {recursive: true, force: true});
	}
});

test('handles concurrent initialization without duplicate rules', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nanocoder-ignore-'));

	try {
		await Promise.all(
			Array.from({length: 10}, () => ensureNanocoderGitignore(root)),
		);

		const content = await fs.readFile(
			path.join(root, '.nanocoder', '.gitignore'),
			'utf8',
		);

		for (const rule of [
			'/checkpoints/',
			'/timeline/',
			'/daemon.*',
			'/ci-watch-state.json*',
		]) {
			t.is(
				content.split('\n').filter(line => line === rule).length,
				1,
			);
		}
	} finally {
		await fs.rm(root, {recursive: true, force: true});
	}
});

test('restores protection when existing rules unignore checkpoints', async t => {
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), 'nanocoder-ignore-'),
	);

	try {
		execFileSync('git', ['init', '-q'], {cwd: root});

		const nanocoderDir = path.join(root, '.nanocoder');
		await fs.mkdir(nanocoderDir, {recursive: true});

		await fs.writeFile(
			path.join(nanocoderDir, '.gitignore'),
			'/checkpoints/\n!/checkpoints/\n',
		);

		await ensureNanocoderGitignore(root);

		const result = execFileSync(
			'git',
			[
				'check-ignore',
				'-q',
				'.nanocoder/checkpoints/test/conversation.json',
			],
			{cwd: root, stdio: 'ignore'},
		);

		t.is(result, null);
	} finally {
		await fs.rm(root, {recursive: true, force: true});
	}
});

test('continues when .gitignore cannot be read', async t => {
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), 'nanocoder-ignore-error-'),
	);

	try {
		const nanocoderDir = path.join(root, '.nanocoder');
		const gitignorePath = path.join(nanocoderDir, '.gitignore');

		await fs.mkdir(gitignorePath, {recursive: true});

		await t.notThrowsAsync(
			ensureNanocoderGitignore(root),
		);

		const stat = await fs.stat(gitignorePath);
		t.true(stat.isDirectory());
	} finally {
		await fs.rm(root, {recursive: true, force: true});
	}
});