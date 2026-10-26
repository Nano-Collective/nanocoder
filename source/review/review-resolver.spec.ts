import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {ReviewActivityStore} from './review-activity';
import {createReviewFixtureTools, createReviewGitFixture} from './review-test-helpers';
import {
	formatResolvedReviewScope,
	resolveReviewScope,
} from './review-resolver';
import {
	assertSafeReviewPath,
	createWorkingTreeSnapshot,
	withTemporaryReviewRefs,
} from './review-snapshot';

function commitFile(
	fixture: ReturnType<typeof createReviewGitFixture>,
	content: string,
	message: string,
): string {
	fixture.write('src/file.ts', content);
	fixture.runGit(['add', '--', 'src/file.ts']);
	fixture.runGit(['commit', '-m', message]);
	return fixture.runGit(['rev-parse', 'HEAD']).trim();
}

function listReviewRefs(
	fixture: ReturnType<typeof createReviewGitFixture>,
): string[] {
	return fixture
		.runGit(['for-each-ref', '--format=%(refname)', 'refs/nanocoder/review/'])
		.split(/\r?\n/)
		.filter(Boolean);
}

test('resolves a remote-only branch to a pinned file snapshot without checkout', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit(['checkout', '-b', 'release/remote-only']);
	const remoteHead = commitFile(fixture, 'export const value = 2;\n', 'remote-only change');
	fixture.runGit(['push', '--set-upstream', 'origin', 'release/remote-only']);
	fixture.runGit(['checkout', 'main']);
	fixture.runGit(['branch', '-D', 'release/remote-only']);
	fixture.runGit(['update-ref', '-d', 'refs/remotes/origin/release/remote-only']);
	const beforeHead = fixture.runGit(['rev-parse', 'HEAD']).trim();
	const beforeStatus = fixture.runGit(['status', '--porcelain=v1', '-z']);
	const activity = new ReviewActivityStore({reviewId: 'remote-only-review'});
	const result = await resolveReviewScope('/review branch release/remote-only', {
		activity,
		tools: createReviewFixtureTools(fixture),
	});

	t.is(result.status, 'ready');
	if (result.status !== 'ready') return;
	t.is(result.snapshot.headOid, remoteHead);
	t.is(result.snapshot.scope.kind, 'branch');
	t.is(result.snapshot.files[0]?.path, 'src/file.ts');
	t.is(result.snapshot.files[0]?.headContent, 'export const value = 2;\n');
	t.deepEqual(result.snapshot.files[0]?.lineMap.changedHeadLines, [1]);
	t.true(
		formatResolvedReviewScope(result.snapshot).includes(
			`base ${result.snapshot.baseOid.slice(0, 12)}`,
		),
	);
	t.true(
		result.activity.events
			.find(event => event.source === 'review')
			?.updates.at(-1)?.summary.includes('1 changed file'),
	);
	t.is(fixture.runGit(['rev-parse', 'HEAD']).trim(), beforeHead);
	t.is(fixture.runGit(['status', '--porcelain=v1', '-z']), beforeStatus);
	t.throws(() =>
		fixture.runGit([
			'show-ref',
			'--verify',
			'--quiet',
			'refs/remotes/origin/release/remote-only',
		]),
	);
	t.deepEqual(listReviewRefs(fixture), []);
	t.true(result.activity.events.some(event => event.name === 'git fetch'));
});

test('asks for a branch choice when local and remote refs collide', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit(['checkout', '-b', 'feature/collision']);
	commitFile(fixture, 'export const collision = true;\n', 'collision branch');
	fixture.runGit(['push', '--set-upstream', 'origin', 'feature/collision']);
	const result = await resolveReviewScope('/review branch feature/collision', {
		tools: createReviewFixtureTools(fixture),
	});

	t.is(result.status, 'clarification');
	if (result.status !== 'clarification') return;
	t.true(result.message.includes('more than one target'));
	t.true(result.choices.some(choice => choice.startsWith('Local:')));
	t.true(result.choices.some(choice => choice.startsWith('Remote:')));
	t.deepEqual(listReviewRefs(fixture), []);
});

test('resolves recent commits by SHA and includes changed-line mappings', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit(['checkout', '-b', 'feature/recent']);
	commitFile(fixture, 'export const value = 2;\n', 'first feature change');
	const baseOid = fixture.runGit(['rev-parse', 'HEAD']).trim();
	commitFile(fixture, 'export const value = 3;\n', 'second feature change');
	const headOid = commitFile(
		fixture,
		'export const value = 4;\n',
		'third feature change',
	);
	const result = await resolveReviewScope(
		'/review the last two commits on this branch',
		{tools: createReviewFixtureTools(fixture)},
	);

	t.is(result.status, 'ready');
	if (result.status !== 'ready') return;
	t.is(result.snapshot.baseOid, baseOid);
	t.is(result.snapshot.headOid, headOid);
	t.is(result.snapshot.scope.kind, 'recent-commits');
	t.is(result.snapshot.scope.commitCount, 2);
	t.is(result.snapshot.files[0]?.baseContent, 'export const value = 2;\n');
	t.is(result.snapshot.files[0]?.headContent, 'export const value = 4;\n');
	t.deepEqual(result.snapshot.files[0]?.lineMap.changedHeadLines, [1]);
});

for (const count of [1, 2]) {
	test(`recent ${count} commits follow first-parent merge history`, async t => {
		const fixture = createReviewGitFixture();
		t.teardown(fixture.cleanup);
		const commitAt = (date: string, message: string, amend = false) =>
			execFileSync('git', ['-C', fixture.root, 'commit', '-m', message, ...(amend ? ['--amend'] : [])], {
				stdio: 'ignore',
				env: {
					...process.env,
					GIT_CONFIG_GLOBAL: '/dev/null',
					GIT_CONFIG_NOSYSTEM: '1',
					GIT_TERMINAL_PROMPT: '0',
					GIT_AUTHOR_DATE: date,
					GIT_COMMITTER_DATE: date,
				},
			});
		commitAt('2019-01-01T00:00:00Z', 'initial commit', true);
		fixture.runGit(['branch', 'side']);
		fixture.write('src/file.ts', 'mainline change\n');
		fixture.runGit(['add', '--', 'src/file.ts']);
		commitAt('2020-01-01T00:00:00Z', 'mainline change');
		fixture.runGit(['checkout', 'side']);
		fixture.write('src/side.ts', 'merged side change\n');
		fixture.runGit(['add', '--', 'src/side.ts']);
		commitAt('2020-01-02T00:00:00Z', 'newer side change');
		fixture.runGit(['checkout', 'main']);
		fixture.runGit(['merge', '--no-ff', 'side', '-m', 'merge side']);
		const expectedBase = fixture.runGit(['rev-parse', `HEAD~${count}`]);
		const result = await resolveReviewScope(`/review last ${count} commits`, {
			tools: createReviewFixtureTools(fixture),
		});

		t.is(result.status, 'ready');
		if (result.status !== 'ready') return;
		t.is(result.snapshot.baseOid, expectedBase);
		t.is(
			result.snapshot.files.find(file => file.path === 'src/side.ts')?.headContent,
			'merged side change\n',
		);
	});
}

test('default scope asks when dirty worktree changes and upstream-ahead commits coexist', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit(['checkout', '-b', 'feature/ahead']);
	commitFile(fixture, 'export const value = 2;\n', 'pushed feature');
	fixture.runGit(['push', '--set-upstream', 'origin', 'feature/ahead']);
	commitFile(fixture, 'export const value = 3;\n', 'unpushed feature');
	fixture.write('src/file.ts', 'export const value = 4;\n');
	const result = await resolveReviewScope('/review', {
		tools: createReviewFixtureTools(fixture),
	});

	t.is(result.status, 'clarification');
	if (result.status !== 'clarification') return;
	t.true(result.message.includes('Both uncommitted worktree changes'));
	t.true(result.choices.some(choice => choice.includes('working tree')));
	t.true(result.choices.some(choice => choice.includes('local commits')));
	t.deepEqual(listReviewRefs(fixture), []);
});

test('default scope fails when Git returns an invalid ahead count', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit(['checkout', '-b', 'feature/ahead-count']);
	commitFile(fixture, 'export const value = 2;\n', 'pushed feature');
	fixture.runGit(['push', '--set-upstream', 'origin', 'feature/ahead-count']);
	commitFile(fixture, 'export const value = 3;\n', 'unpushed feature');
	const tools = createReviewFixtureTools(fixture);
	const execGit = tools.execGit;
	tools.execGit = async (args, signal) => {
		if (args[0] === 'rev-list' && args.includes('--count')) {
			return 'not a count';
		}
		return execGit(args, signal);
	};
	const result = await resolveReviewScope('/review', {tools});

	t.is(result.status, 'failed');
	if (result.status === 'failed') {
		t.true(result.message.includes('could not determine the current branch-ahead count'));
	}
	t.deepEqual(listReviewRefs(fixture), []);
});

test('default scope snapshots dirty-only worktree content and reports a digest', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.write('src/file.ts', 'export const value = 9;\n');
	fixture.write('src/untracked file.ts', 'export const fresh = true;\n');
	const result = await resolveReviewScope('/review', {
		tools: createReviewFixtureTools(fixture),
	});

	t.is(result.status, 'ready');
	if (result.status !== 'ready') return;
	t.is(result.snapshot.headKind, 'working-tree');
	t.is(result.snapshot.files[0]?.headContent, 'export const value = 9;\n');
	t.is(result.snapshot.files[0]?.baseContent, 'export const value = 1;\n');
	const untracked = result.snapshot.files.find(
		file => file.path === 'src/untracked file.ts',
	);
	t.is(untracked?.status, 'added');
	t.is(untracked?.headContent, 'export const fresh = true;\n');
	t.deepEqual(untracked?.lineMap.changedHeadLines, [1]);
	t.regex(result.snapshot.headDigest ?? '', /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
	t.is(result.snapshot.baseOid, result.snapshot.headOid);
});

test('worktree snapshots include repository-relative paths when launched from a subdirectory', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.write('tracked.ts', 'root before\n');
	fixture.runGit(['add', '--', 'tracked.ts']);
	fixture.runGit(['commit', '-m', 'track root file']);
	fixture.write('tracked.ts', 'root after\n');
	fixture.write('src/file.ts', 'source after\n');
	fixture.write('fresh.ts', 'root untracked\n');
	fixture.write('src/fresh.ts', 'source untracked\n');
	const options = {
		cwd: join(fixture.root, 'src'),
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: '/dev/null',
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_TERMINAL_PROMPT: '0',
		},
	};
	const tools = createReviewFixtureTools(fixture);
	tools.execGit = async (args, _signal, env) =>
		execFileSync('git', args, {...options, env: {...options.env, ...env}, encoding: 'utf8'}).trimEnd();
	tools.execGitBuffer = async args => execFileSync('git', args, options);
	const result = await resolveReviewScope('/review working tree', {tools});

	t.is(result.status, 'ready');
	if (result.status !== 'ready') return;
	t.deepEqual(
		result.snapshot.files.map(file => [file.path, file.headContent]).sort(),
		[
			['fresh.ts', 'root untracked\n'],
			['src/file.ts', 'source after\n'],
			['src/fresh.ts', 'source untracked\n'],
			['tracked.ts', 'root after\n'],
		],
	);
});

test('resolver returns a failed result when an activity store is reused', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	const activity = new ReviewActivityStore({reviewId: 'single-use-store'});
	const tools = createReviewFixtureTools(fixture);
	const first = await resolveReviewScope('/review working tree', {
		activity,
		tools,
	});
	t.is(first.status, 'ready');

	const second = await resolveReviewScope('/review working tree', {
		activity,
		tools,
	});
	t.is(second.status, 'failed');
	if (second.status === 'failed') {
		t.true(second.message.includes('create a new store for each review'));
		t.is(second.activity.status, 'failed');
	}
});

test('pull-request number detects fork/upstream collisions and explicit URL pins the PR snapshot', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit(['checkout', '-b', 'feature/pr']);
	const headOid = commitFile(fixture, 'export const value = 5;\n', 'PR change');
	const baseOid = fixture.runGit(['rev-parse', 'main']).trim();
	fixture.runGit(['push', 'origin', 'feature/pr:refs/heads/pr-7-head']);
	fixture.runRemoteGit(['update-ref', 'refs/pull/7/head', headOid]);
	fixture.runGit(['checkout', 'main']);
	fixture.write('src/base-only.ts', 'export const baseOnly = true;\n');
	fixture.runGit(['add', '--', 'src/base-only.ts']);
	fixture.runGit(['commit', '-m', 'advance base after PR opened']);
	const latestBaseOid = fixture.runGit(['rev-parse', 'HEAD']).trim();
	fixture.runGit(['push', 'origin', 'main']);
	fixture.runGit(['checkout', 'feature/pr']);
	fixture.runGit(['remote', 'set-url', 'origin', 'git@github.com:user/fork.git']);
	fixture.runGit(['remote', 'add', 'upstream', 'git@github.com:acme/repo.git']);

	const pull = {
		head: {
			sha: headOid,
			ref: 'feature/pr',
			repo: {full_name: 'user/fork'},
		},
		base: {
			sha: baseOid,
			ref: 'main',
			repo: {full_name: 'acme/repo'},
		},
	};
	const execGh = async (args: string[]) => {
		const path = args[1]?.replace(/^repos\//, '') ?? '';
		if (path === 'user/fork') {
			return JSON.stringify({full_name: 'user/fork', parent: {full_name: 'acme/repo'}});
		}
		if (path === 'acme/repo') {
			return JSON.stringify({full_name: 'acme/repo', parent: null});
		}
		if (path === 'user/fork/pulls/7' || path === 'acme/repo/pulls/7') {
			return JSON.stringify(pull);
		}
		throw new Error('HTTP 404: Not Found');
	};
	const tools = createReviewFixtureTools(fixture, {
		execGh,
	});
	const originalExecGit = tools.execGit;
	tools.execGit = async (args, signal) => {
		const redirectedArgs = [...args];
		const upstreamIndex = redirectedArgs.indexOf('upstream');
		if (redirectedArgs[0] === 'fetch' && upstreamIndex >= 0) {
			redirectedArgs[upstreamIndex] = fixture.remote;
		}
		return originalExecGit(redirectedArgs, signal);
	};
	tools.githubRepositoryUrl = () => {
		throw new Error('A configured SSH remote should be used instead.');
	};
	const beforeHead = fixture.runGit(['rev-parse', 'HEAD']).trim();
	const beforeStatus = fixture.runGit(['status', '--porcelain=v1', '-z']);
	const collision = await resolveReviewScope('/review PR 7', {tools});
	t.is(collision.status, 'clarification');
	if (collision.status === 'clarification') {
		t.true(collision.choices.includes('user/fork#7'));
		t.true(collision.choices.includes('acme/repo#7'));
	}

	const result = await resolveReviewScope(
		'https://github.com/acme/repo/pull/7',
		{tools},
	);
	t.is(result.status, 'ready');
	if (result.status !== 'ready') return;
	t.is(result.snapshot.baseOid, baseOid);
	t.is(result.snapshot.baseTipOid, latestBaseOid);
	t.is(result.snapshot.headOid, headOid);
	t.not(result.snapshot.baseOid, latestBaseOid);
	t.is(result.snapshot.scope.kind, 'pull-request');
	t.is(result.snapshot.remoteRepository, 'acme/repo');
	t.is(result.snapshot.files[0]?.headContent, 'export const value = 5;\n');
	t.false(result.snapshot.files.some(file => file.path === 'src/base-only.ts'));
	t.true(formatResolvedReviewScope(result.snapshot).includes(`tip ${latestBaseOid.slice(0, 12)}`));
	t.is(fixture.runGit(['rev-parse', 'HEAD']).trim(), beforeHead);
	t.is(fixture.runGit(['status', '--porcelain=v1', '-z']), beforeStatus);
	t.deepEqual(listReviewRefs(fixture), []);
});

test('bare pull-request lookup fails closed when a configured repository is inaccessible', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit([
		'remote',
		'set-url',
		'origin',
		'https://github.com/acme/repo.git',
	]);
	fixture.runGit([
		'remote',
		'add',
		'mirror',
		'https://github.com/private/mirror.git',
	]);
	const tools = createReviewFixtureTools(fixture, {
		execGh: async args => {
			if (args[1] === 'repos/acme/repo') {
				return JSON.stringify({full_name: 'acme/repo', parent: null});
			}
			throw new Error('HTTP 404: Not Found');
		},
	});
	const result = await resolveReviewScope('/review PR 7', {tools});

	t.is(result.status, 'failed');
	if (result.status === 'failed') {
		t.true(result.message.includes('private/mirror'));
		t.true(result.message.includes('Pass a full PR URL'));
	}
});

test('request text is never used as shell input and unsafe changed paths are rejected', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	const marker = join(fixture.root, 'pwned');
	const commands: string[][] = [];
	const tools = createReviewFixtureTools(fixture);
	const originalExecGit = tools.execGit;
	tools.execGit = async (args, signal) => {
		commands.push([...args]);
		return originalExecGit(args, signal);
	};

	const result = await resolveReviewScope(
		`/review branch "feature; touch ${marker}"`,
		{tools},
	);
	t.is(result.status, 'failed');
	t.false(existsSync(marker));
	t.false(commands.some(args => args.some(arg => arg.includes('touch'))));
	t.throws(() => assertSafeReviewPath('../outside.txt'));
	t.throws(() => assertSafeReviewPath('/etc/passwd'));
	t.throws(() => assertSafeReviewPath('C:\\outside.txt'));
});

let idCounter = 0;
function randomId(): string {
	idCounter += 1;
	return `review-${idCounter}`;
}

// Creating symlinks on Windows needs administrator rights or Developer Mode.
const symlinkTest = process.platform === 'win32' ? test.skip : test;

symlinkTest('worktree snapshots read symlink text, not a file outside the repository', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	const outside = join(fixture.root, '..', 'outside-secret.txt');
	writeFileSync(outside, 'do not read this secret');
	symlinkSync('../outside-secret.txt', join(fixture.root, 'src', 'external.ts'));
	const activity = new ReviewActivityStore({reviewId: 'symlink-snapshot'});
	const snapshot = await createWorkingTreeSnapshot(
		{scope: {kind: 'working-tree', description: 'test symlink safety'}},
		{tools: createReviewFixtureTools(fixture), activity},
	);

	const file = snapshot.files.find(candidate => candidate.path === 'src/external.ts');
	t.is(file?.headContent, '../outside-secret.txt');
	t.false(file?.headContent?.includes('do not read this secret'));
});

test('worktree snapshots leave the real index and files untouched', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.write('src/file.ts', 'export const value = 2;\n');
	fixture.runGit(['add', '--', 'src/file.ts']);
	fixture.write('src/file.ts', 'export const value = 3;\n');
	fixture.write('src/new.ts', 'export const added = true;\n');
	const indexPath = fixture.runGit(['rev-parse', '--path-format=absolute', '--git-path', 'index']);
	// `git status` refreshes the index stat cache, so read the index after it.
	const statusBefore = fixture.runGit(['status', '--porcelain=v1', '-z']);
	const indexBefore = readFileSync(indexPath);
	const snapshot = await createWorkingTreeSnapshot(
		{scope: {kind: 'working-tree', description: 'index safety'}},
		{
			tools: createReviewFixtureTools(fixture),
			activity: new ReviewActivityStore({reviewId: 'index-safety'}),
		},
	);

	t.deepEqual(
		snapshot.files.map(file => [file.path, file.headContent]).sort(),
		[
			['src/file.ts', 'export const value = 3;\n'],
			['src/new.ts', 'export const added = true;\n'],
		],
	);
	t.true(readFileSync(indexPath).equals(indexBefore));
	t.is(fixture.runGit(['status', '--porcelain=v1', '-z']), statusBefore);
	t.is(fixture.runGit(['diff', '--cached', '--name-only']), 'src/file.ts');
});

function skipEvents(activity: ReviewActivityStore) {
	return activity
		.getEvents()
		.filter(event => event.name === 'Skip secret-looking files');
}

test('worktree snapshots skip a secret-looking untracked file and keep templates and normal files', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.write('.env.local', 'API_TOKEN=do-not-send-this\n');
	fixture.write('.env.example', 'API_TOKEN=\n');
	fixture.write('src/new.ts', 'export const added = true;\n');
	const secretOid = fixture.runGit(['hash-object', '.env.local']);
	const activity = new ReviewActivityStore({reviewId: 'secret-skip'});
	const snapshot = await createWorkingTreeSnapshot(
		{scope: {kind: 'working-tree', description: 'secret skip'}},
		{tools: createReviewFixtureTools(fixture), activity},
	);

	t.deepEqual(snapshot.files.map(file => file.path).sort(), [
		'.env.example',
		'src/new.ts',
	]);
	t.deepEqual(
		skipEvents(activity).map(event => event.updates[0]?.summary),
		['Skipped 1 untracked file that may contain secrets: .env.local'],
	);
	t.false(JSON.stringify(activity.toSummary()).includes('do-not-send-this'));
	// The skipped file is never hashed into the object store.
	t.throws(() => fixture.runGit(['cat-file', '-e', secretOid]));
});

test('worktree snapshots skip every secret-looking pattern and keep look-alike names', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	const secrets = [
		'.env',
		'config/.env.production',
		'.netrc',
		'.npmrc',
		'.aws/credentials',
		'.ssh/id_rsa',
		'.ssh/id_ed25519',
		'certs/server.pem',
		'certs/server.key',
		'certs/client.p12',
		'certs/client.pfx',
		'android/release.keystore',
		'certs/[prod].pem',
	];
	for (const path of secrets) fixture.write(path, 'secret\n');
	const kept = ['src/env.ts', 'src/api.key.ts', '.environment'];
	for (const path of kept) fixture.write(path, 'kept\n');
	const activity = new ReviewActivityStore({reviewId: 'secret-patterns'});
	const snapshot = await createWorkingTreeSnapshot(
		{scope: {kind: 'working-tree', description: 'secret patterns'}},
		{tools: createReviewFixtureTools(fixture), activity},
	);

	t.deepEqual(snapshot.files.map(file => file.path).sort(), [...kept].sort());
	const summaries = skipEvents(activity).map(event => event.updates[0]?.summary);
	t.is(summaries.length, 1);
	t.regex(
		summaries[0] ?? '',
		/^Skipped 13 untracked files that may contain secrets: (?:[^,]+, ){4}[^,]+ and 8 more$/,
	);
});

test('worktree snapshots review committed secret-looking files as they are', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.write('.npmrc', 'registry=https://registry.example.test/\n');
	fixture.runGit(['add', '--', '.npmrc']);
	fixture.runGit(['commit', '-m', 'add npmrc']);
	fixture.write('.npmrc', 'registry=https://mirror.example.test/\n');
	const activity = new ReviewActivityStore({reviewId: 'tracked-secret'});
	const snapshot = await createWorkingTreeSnapshot(
		{scope: {kind: 'working-tree', description: 'tracked secret-looking file'}},
		{tools: createReviewFixtureTools(fixture), activity},
	);

	t.deepEqual(
		snapshot.files.map(file => [file.path, file.headContent]),
		[['.npmrc', 'registry=https://mirror.example.test/\n']],
	);
	t.deepEqual(skipEvents(activity), []);
});

function toolsWithIndexPath(
	fixture: ReturnType<typeof createReviewGitFixture>,
	indexPath: string,
) {
	const tools = createReviewFixtureTools(fixture);
	const execGit = tools.execGit;
	tools.execGit = async (args, signal, env) =>
		args.includes('--git-path') ? indexPath : execGit(args, signal, env);
	return tools;
}

test('a repository without a Git index starts the scratch index empty without a warning', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.write('src/file.ts', 'export const value = 2;\n');
	fixture.write('src/new.ts', 'export const added = true;\n');
	const activity = new ReviewActivityStore({reviewId: 'missing-index'});
	const snapshot = await createWorkingTreeSnapshot(
		{scope: {kind: 'working-tree', description: 'missing index'}},
		{tools: toolsWithIndexPath(fixture, join(fixture.root, 'missing-index')), activity},
	);

	t.deepEqual(snapshot.files.map(file => file.path).sort(), [
		'src/file.ts',
		'src/new.ts',
	]);
	t.false(activity.getEvents().some(event => event.name === 'Copy Git index'));
});

test('a Git index that cannot be copied is reported and the snapshot still completes', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.write('src/file.ts', 'export const value = 2;\n');
	fixture.write('src/new.ts', 'export const added = true;\n');
	const activity = new ReviewActivityStore({reviewId: 'unreadable-index'});
	// A directory cannot be copied as a file, so the copy fails with an error
	// other than a missing index.
	const snapshot = await createWorkingTreeSnapshot(
		{scope: {kind: 'working-tree', description: 'unreadable index'}},
		{tools: toolsWithIndexPath(fixture, fixture.root), activity},
	);

	t.deepEqual(snapshot.files.map(file => file.path).sort(), [
		'src/file.ts',
		'src/new.ts',
	]);
	const warnings = activity
		.getEvents()
		.filter(event => event.name === 'Copy Git index');
	t.is(warnings.length, 1);
	t.is(warnings[0]?.status, 'failed');
	t.is(
		warnings[0]?.updates.at(-1)?.summary,
		'Could not copy the Git index; recording the worktree from an empty index instead',
	);
});

test('remote revisions use one fixed ref per source and are removed after success and failure', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	const activity = new ReviewActivityStore({reviewId: 'fixed-ref-lifecycle'});
	const tools = createReviewFixtureTools(fixture);
	const execGit = tools.execGit;
	const destinations: string[] = [];
	tools.execGit = async (args, signal, env) => {
		if (args[0] === 'fetch') destinations.push(args.at(-1) ?? '');
		return execGit(args, signal, env);
	};
	const mainOid = fixture.runGit(['rev-parse', 'main']).trim();

	await withTemporaryReviewRefs({tools, activity}, async refs => {
		t.is(await refs.fetch('origin', 'refs/heads/main', mainOid), mainOid);
	});
	await t.throwsAsync(
		withTemporaryReviewRefs({tools, activity}, async refs => {
			await refs.fetch('origin', 'refs/heads/main', mainOid);
			throw new Error('simulated snapshot failure');
		}),
		{message: 'simulated snapshot failure'},
	);

	t.is(destinations.length, 2);
	t.is(destinations[0], destinations[1]);
	t.regex(destinations[0] ?? '', /^\+refs\/heads\/main:refs\/nanocoder\/review\/[0-9a-f]{12}\/heads\/main$/);
	t.deepEqual(listReviewRefs(fixture), []);
});

test('a failed ref removal does not fail the review and the next run reuses the ref', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	const tools = createReviewFixtureTools(fixture);
	const execGit = tools.execGit;
	let failDeletes = true;
	tools.execGit = async (args, signal, env) => {
		if (args[0] === 'update-ref' && args[1] === '-d' && failDeletes) {
			throw new Error('simulated ref deletion failure');
		}
		return execGit(args, signal, env);
	};
	const mainOid = fixture.runGit(['rev-parse', 'main']).trim();
	const run = () =>
		withTemporaryReviewRefs(
			{tools, activity: new ReviewActivityStore({reviewId: randomId()})},
			async refs => refs.fetch('origin', 'refs/heads/main', mainOid),
		);

	t.is(await run(), mainOid);
	const leftBehind = listReviewRefs(fixture);
	t.is(leftBehind.length, 1);
	t.is(await run(), mainOid);
	t.deepEqual(listReviewRefs(fixture), leftBehind);
	failDeletes = false;
	await run();
	t.deepEqual(listReviewRefs(fixture), []);
});

test('aborted remote fetch cleans its temporary ref and returns cancelled status', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit(['checkout', '-b', 'remote/cancel-test']);
	commitFile(fixture, 'export const value = 6;\n', 'cancel test');
	fixture.runGit(['push', '--set-upstream', 'origin', 'remote/cancel-test']);
	fixture.runGit(['checkout', 'main']);
	fixture.runGit(['branch', '-D', 'remote/cancel-test']);
	fixture.runGit(['update-ref', '-d', 'refs/remotes/origin/remote/cancel-test']);
	const controller = new AbortController();
	const tools = createReviewFixtureTools(fixture);
	const originalExecGit = tools.execGit;
	tools.execGit = async (args, signal) => {
		if (args[0] === 'fetch') {
			controller.abort();
			throw new Error('cancelled by test');
		}
		return originalExecGit(args, signal);
	};
	const result = await resolveReviewScope('/review branch remote/cancel-test', {
		tools,
		signal: controller.signal,
	});

	t.is(result.status, 'cancelled');
	t.deepEqual(listReviewRefs(fixture), []);
});
