import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import test from 'ava';
import {getProjectRoot, getSessionCwd} from '@/services/session-cwd';
import {readFileTool} from '@/tools/read-file';
import {createPrWorktree, parseWorktreePrNumber} from './gh-pr-worktree';

type MockOptions = {
	gitFailure?: (args: string[]) => string | undefined;
	ghFailure?: (args: string[]) => string | undefined;
	branchExists?: boolean;
	remotes?: string;
	registeredBranch?: string;
	partialRegistrationOnFailure?: boolean;
};

function fixture(options: MockOptions = {}) {
	const root = mkdtempSync(join(tmpdir(), 'nanocoder-pr-test-'));
	const worktree = join(dirname(root), `${basename(root)}-pr-42`);
	const gitCalls: string[][] = [];
	const ghCalls: string[][] = [];
	let entered: string | undefined;
	let registeredBranch = options.registeredBranch;
	const dependencies = {
		execGit: async (args: string[]) => {
			gitCalls.push(args);
			const failure = options.gitFailure?.(args);
			if (args.includes('worktree') && args.includes('add')) {
				if (!failure || options.partialRegistrationOnFailure) {
					registeredBranch = 'refs/heads/nanocoder/pr-42';
				}
				if (failure) throw new Error(failure);
				return '';
			}
			if (failure) throw new Error(failure);
			if (args.includes('worktree') && args.includes('list')) {
				return registeredBranch
					? `worktree ${worktree}\nHEAD 0000000\nbranch ${registeredBranch}\n`
					: '';
			}
			if (args.includes('worktree') && args.includes('remove')) {
				registeredBranch = undefined;
				rmSync(worktree, {recursive: true, force: true});
				return '';
			}
			if (args[0] === '--version') return 'git version 2.0';
			if (args.includes('--show-toplevel')) return root;
			if (args.at(-1) === 'remote') return options.remotes ?? 'origin\nupstream';
			if (args.includes('get-url')) {
				return args.at(-1) === 'upstream'
					? 'git@github.com:Nano-Collective/nanocoder.git'
					: 'https://github.com/example/nanocoder.git';
			}
			if (args.includes('--list')) {
				return options.branchExists ? 'refs/heads/nanocoder/pr-42' : '';
			}
			return '';
		},
		execGh: async (args: string[]) => {
			ghCalls.push(args);
			const failure = options.ghFailure?.(args);
			if (failure) throw new Error(failure);
			return '';
		},
		changeDirectory: (path: string) => {
			entered = path;
		},
	};
	return {
		root,
		worktree,
		gitCalls,
		ghCalls,
		dependencies,
		get entered() {
			return entered;
		},
		clean() {
			rmSync(worktree, {recursive: true, force: true});
			rmSync(root, {recursive: true, force: true});
		},
	};
}

test('PR worktree command requires exactly one positive decimal number', t => {
	t.is(parseWorktreePrNumber(['42']), '42');
	for (const args of [[], ['0'], ['-1'], ['abc'], ['42x'], ['01'], ['42', '43']]) {
		t.throws(() => parseWorktreePrNumber(args), {message: /Usage: nanocoder worktree/});
	}
});

test('PR from a contributor fork is fetched through upstream and entered', async t => {
	const f = fixture();
	try {
		const result = await createPrWorktree('42', f.root, f.dependencies);
		t.is(result, f.worktree);
		t.is(f.entered, f.worktree);
		t.true(existsSync(f.worktree));
		t.deepEqual(f.ghCalls.at(-1), [
			'pr',
			'view',
			'42',
			'--repo',
			'Nano-Collective/nanocoder',
			'--json',
			'number',
		]);
		t.true(
			f.gitCalls.some(args =>
				args.join(' ').includes('fetch --no-tags upstream refs/pull/42/head'),
			),
		);
		t.true(
			f.gitCalls.some(args =>
				args.join(' ').includes(`worktree add ${f.worktree} nanocoder/pr-42`),
			),
		);
	} finally {
		f.clean();
	}
});

test('an existing path, including an existing empty directory, is preserved', async t => {
	const f = fixture();
	try {
		mkdirSync(f.worktree);
		const marker = join(f.worktree, 'keep.txt');
		writeFileSync(marker, 'keep');
		await t.throwsAsync(createPrWorktree('42', f.root, f.dependencies), {
			message: /Worktree path already exists/,
		});
		t.true(existsSync(marker));
		t.false(f.gitCalls.some(args => args.includes('fetch')));
	} finally {
		f.clean();
	}
});

test('an existing local PR branch is rejected before fetching', async t => {
	const f = fixture({branchExists: true});
	try {
		await t.throwsAsync(createPrWorktree('42', f.root, f.dependencies), {
			message: /Local branch nanocoder\/pr-42 already exists/,
		});
		t.false(existsSync(f.worktree));
		t.false(f.gitCalls.some(args => args.includes('fetch')));
	} finally {
		f.clean();
	}
});

test('a registered worktree is preserved even when its directory is missing', async t => {
	const f = fixture({registeredBranch: 'refs/heads/another-branch'});
	try {
		await t.throwsAsync(createPrWorktree('42', f.root, f.dependencies), {
			message: /Git already has a worktree registered/,
		});
		t.false(existsSync(f.worktree));
		t.false(f.gitCalls.some(args => args.includes('remove')));
		t.false(f.gitCalls.some(args => args.includes('fetch')));
	} finally {
		f.clean();
	}
});

test('missing Git, gh, and gh authentication produce distinct errors', async t => {
	const cases = [
		{options: {gitFailure: (args: string[]) => args[0] === '--version' ? 'missing' : undefined}, message: /Git is required/},
		{options: {ghFailure: (args: string[]) => args[0] === '--version' ? 'missing' : undefined}, message: /GitHub CLI \(gh\) is required/},
		{options: {ghFailure: (args: string[]) => args[0] === 'auth' ? 'not logged in' : undefined}, message: /gh auth login/},
	];
	for (const {options, message} of cases) {
		const f = fixture(options);
		try {
			await t.throwsAsync(createPrWorktree('42', f.root, f.dependencies), {message});
			t.false(existsSync(f.worktree));
		} finally {
			f.clean();
		}
	}
});

test('unavailable PR and fetch failure leave no new directory', async t => {
	const cases = [
		{options: {ghFailure: (args: string[]) => args[0] === 'pr' ? 'not found' : undefined}, message: /Could not find PR #42/},
		{options: {gitFailure: (args: string[]) => args.includes('fetch') ? 'network failed' : undefined}, message: /Could not fetch PR #42/},
	];
	for (const {options, message} of cases) {
		const f = fixture(options);
		try {
			await t.throwsAsync(createPrWorktree('42', f.root, f.dependencies), {message});
			t.false(existsSync(f.worktree));
		} finally {
			f.clean();
		}
	}
});

test('failed worktree setup removes only its reserved directory and branch', async t => {
	const f = fixture({
		gitFailure: args => args.includes('add') ? 'checkout failed' : undefined,
		partialRegistrationOnFailure: true,
	});
	try {
		await t.throwsAsync(createPrWorktree('42', f.root, f.dependencies), {
			message: /Could not add Git worktree.*checkout failed/,
		});
		t.false(existsSync(f.worktree));
		t.true(existsSync(f.root));
		t.true(f.gitCalls.some(args => args.includes('remove') && args.includes(f.worktree)));
		t.true(f.gitCalls.some(args => args.includes('-D') && args.includes('nanocoder/pr-42')));
	} finally {
		f.clean();
	}
});

test('failure to enter the worktree also removes its new branch and directory', async t => {
	const f = fixture();
	try {
		await t.throwsAsync(
			createPrWorktree('42', f.root, {
				...f.dependencies,
				changeDirectory: () => {
					throw new Error('directory disappeared');
				},
			}),
			{message: /Could not enter Git worktree.*directory disappeared/},
		);
		t.false(existsSync(f.worktree));
		t.true(f.gitCalls.some(args => args.includes('-D') && args.includes('nanocoder/pr-42')));
	} finally {
		f.clean();
	}
});

test.serial('entering the worktree makes it the session cwd and project root', async t => {
	const f = fixture();
	const originalCwd = process.cwd();
	try {
		await createPrWorktree('42', f.root, {
			...f.dependencies,
			changeDirectory: path => process.chdir(path),
		});
		t.is(process.cwd(), f.worktree);
		t.is(getSessionCwd(), f.worktree);
		t.is(getProjectRoot(), f.worktree);
	} finally {
		process.chdir(originalCwd);
		f.clean();
	}
});

function localGitFixture() {
	const fixtureRoot = mkdtempSync(join(tmpdir(), 'nanocoder pr git '));
	const repo = join(fixtureRoot, 'repo with spaces');
	const bare = join(fixtureRoot, 'pull refs.git');
	const worktree = join(fixtureRoot, 'repo with spaces-pr-42');
	const git = (args: string[]) =>
		execFileSync('git', args, {encoding: 'utf8'}).trimEnd();
	try {
		git(['init', '-b', 'main', repo]);
		git(['-C', repo, 'config', 'user.name', 'Nanocoder Test']);
		git(['-C', repo, 'config', 'user.email', 'test@example.com']);
		writeFileSync(join(repo, 'file.txt'), 'base\n');
		git(['-C', repo, 'add', 'file.txt']);
		git(['-C', repo, 'commit', '-m', 'base']);
		git(['init', '--bare', bare]);
		git(['-C', repo, 'remote', 'add', 'origin', 'git@github.com:myfork/repo.git']);
		git(['-C', repo, 'remote', 'add', 'upstream', 'git@github.com:Nano-Collective/repo.git']);
		git(['-C', repo, 'switch', '-c', 'contributor']);
		writeFileSync(join(repo, 'file.txt'), 'contributor change\n');
		git(['-C', repo, 'commit', '-am', 'contributor change']);
		const prHead = git(['-C', repo, 'rev-parse', 'HEAD']);
		git(['-C', repo, 'push', bare, 'HEAD:refs/pull/42/head']);
		git(['-C', repo, 'switch', 'main']);
		writeFileSync(join(repo, 'file.txt'), 'dirty launch checkout\n');
		writeFileSync(join(repo, 'staged.txt'), 'staged launch file\n');
		git(['-C', repo, 'add', 'staged.txt']);
		writeFileSync(join(repo, 'untracked.txt'), 'untracked launch file\n');
		const originalStatus = git(['-C', repo, 'status', '--porcelain']);
		const ghCalls: string[][] = [];
		const execGit = async (args: string[]) => {
			const fetchRemote = args[2] === 'fetch' ? args.indexOf('upstream') : -1;
			const safeArgs = [...args];
			if (fetchRemote !== -1) safeArgs[fetchRemote] = bare;
			return git(safeArgs);
		};
		return {
			fixtureRoot,
			repo,
			worktree,
			prHead,
			originalStatus,
			ghCalls,
			git,
			execGit,
			execGh: async (args: string[]) => {
				ghCalls.push(args);
				return '';
			},
			clean() {
				if (existsSync(worktree)) {
					git(['-C', repo, 'worktree', 'remove', '--force', worktree]);
				}
				rmSync(fixtureRoot, {recursive: true, force: true});
			},
		};
	} catch (error) {
		rmSync(fixtureRoot, {recursive: true, force: true});
		throw error;
	}
}

test.serial('real Git worktree makes relative file reads use the PR head and preserves a dirty launch checkout', async t => {
	const f = localGitFixture();
	const originalCwd = process.cwd();
	try {
		const created = await createPrWorktree('42', f.repo, {
			execGit: f.execGit,
			execGh: f.execGh,
			changeDirectory: path => process.chdir(path),
		});
		t.is(created, f.worktree);
		t.is(process.cwd(), f.worktree);
		t.is(getProjectRoot(), f.worktree);
		t.is(getSessionCwd(), f.worktree);
		t.is(f.git(['-C', f.worktree, 'rev-parse', 'HEAD']), f.prHead);
		t.is(f.git(['-C', f.worktree, 'branch', '--show-current']), 'nanocoder/pr-42');
		const readResult = await readFileTool.tool.execute!(
			{path: 'file.txt'},
			{toolCallId: 'pr-read', messages: []},
		);
		t.regex(readResult, /contributor change/);
		t.false(readResult.includes('dirty launch checkout'));
		t.is(f.git(['-C', f.repo, 'branch', '--show-current']), 'main');
		t.is(f.git(['-C', f.repo, 'status', '--porcelain']), f.originalStatus);
		t.is(readFileSync(join(f.repo, 'file.txt'), 'utf8'), 'dirty launch checkout\n');
		t.is(readFileSync(join(f.repo, 'staged.txt'), 'utf8'), 'staged launch file\n');
		t.is(readFileSync(join(f.repo, 'untracked.txt'), 'utf8'), 'untracked launch file\n');
		t.is(f.git(['-C', f.repo, 'remote', 'get-url', 'origin']), 'git@github.com:myfork/repo.git');
		t.deepEqual(f.ghCalls.at(-1), [
			'pr', 'view', '42', '--repo', 'Nano-Collective/repo', '--json', 'number',
		]);
	} finally {
		process.chdir(originalCwd);
		f.clean();
	}
});

test.serial('partial real Git setup failure removes its worktree but keeps pre-existing files', async t => {
	const f = localGitFixture();
	const preexisting = join(f.fixtureRoot, 'keep this folder');
	const marker = join(preexisting, 'keep.txt');
	try {
		mkdirSync(preexisting);
		writeFileSync(marker, 'pre-existing data');
		await t.throwsAsync(
			createPrWorktree('42', f.repo, {
				execGit: async args => {
					const result = await f.execGit(args);
					if (args.includes('worktree') && args.includes('add')) {
						throw new Error('simulated failure after Git registered the worktree');
					}
					return result;
				},
				execGh: f.execGh,
				changeDirectory: () => {},
			}),
			{message: /simulated failure after Git registered the worktree/},
		);
		t.false(existsSync(f.worktree));
		t.is(f.git(['-C', f.repo, 'branch', '--list', 'nanocoder/pr-42']), '');
		t.is(f.git(['-C', f.repo, 'status', '--porcelain']), f.originalStatus);
		t.is(readFileSync(marker, 'utf8'), 'pre-existing data');
	} finally {
		f.clean();
	}
});
