import {execFileSync} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test, {type ExecutionContext} from 'ava';
import type {LLMClient, Message} from '@/types/core';
import {ensureNanocoderGitignore} from '@/utils/fs/ensure-nanocoder-gitignore';
import {runSwarm, type SwarmDependencies} from './coordinator';
import {formatSwarmSummary} from './summary';
import type {SwarmConfig, SwarmSnapshot} from './types';

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, {cwd, encoding: 'utf-8', stdio: 'pipe'});
}

function createRepo(t: ExecutionContext): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'nanocoder-swarm-')));
	t.teardown(() => rmSync(dir, {recursive: true, force: true}));
	git(dir, 'init', '-q');
	git(dir, 'config', 'user.name', 'Test User');
	git(dir, 'config', 'user.email', 'test@example.com');
	write(dir, 'src/a/one.ts', 'export const one = 1;\n');
	write(dir, 'src/b/two.ts', 'export const two = 2;\n');
	write(dir, '.gitignore', 'agents.config.json\n');
	git(dir, 'add', '.');
	git(dir, 'commit', '-qm', 'initial');
	return dir;
}

function write(root: string, file: string, content: string | Buffer) {
	mkdirSync(dirname(join(root, file)), {recursive: true});
	writeFileSync(join(root, file), content);
}

const read = (root: string, file: string) =>
	readFileSync(join(root, file), 'utf-8');

function planClient(...replies: string[]) {
	const seen: Message[][] = [];
	const client: Pick<LLMClient, 'chat'> = {
		chat: async messages => {
			seen.push([...messages]);
			const content = replies[Math.min(seen.length, replies.length) - 1] ?? '';
			return {
				choices: [{message: {role: 'assistant', content}}],
				toolsDisabled: false,
			};
		},
	};
	return {client, seen};
}

const TWO_TASKS = JSON.stringify({
	tasks: [
		{id: 'a', description: 'edit a', fileScope: ['src/a/']},
		{id: 'b', description: 'edit b', fileScope: ['src/b']},
	],
});

const config = (overrides: Partial<SwarmConfig> = {}): SwarmConfig => ({
	prompt: 'update both modules',
	workers: 2,
	swarmMode: 'review',
	timeoutMs: 60_000,
	...overrides,
});

type Behaviour = (worktree: string, signal: AbortSignal) => unknown;

function dependencies(
	cwd: string,
	behaviours: Record<string, Behaviour>,
	overrides: Partial<SwarmDependencies> = {},
): SwarmDependencies {
	return {
		client: planClient(TWO_TASKS).client,
		cwd,
		cliPath: '/unused',
		workerOptions: [],
		signal: new AbortController().signal,
		onUpdate: () => undefined,
		confirmApply: async () => true,
		runWorker: async options => {
			const id = options.cwd.split(/[\\/]/).pop() ?? '';
			await behaviours[id]?.(options.cwd, options.signal);
			return {tokens: 7};
		},
		...overrides,
	};
}

const editBoth: Record<string, Behaviour> = {
	a: dir => write(dir, 'src/a/one.ts', 'export const one = 11;\n'),
	b: dir => write(dir, 'src/b/two.ts', 'export const two = 22;\n'),
};

function assertNoLeftovers(t: ExecutionContext, dir: string) {
	t.is(git(dir, 'worktree', 'list').trim().split('\n').length, 1);
	t.is(git(dir, 'branch', '--list', 'nanocoder-swarm-*').trim(), '');
}

test('review mode saves patches and leaves the working tree alone', async t => {
	const dir = createRepo(t);
	const result = await runSwarm(config(), dependencies(dir, editBoth));

	t.is(result.status, 'complete', result.error);
	t.false(result.applied);
	t.is(result.patches.length, 2);
	t.is(read(dir, 'src/a/one.ts'), 'export const one = 1;\n');
	t.is(git(dir, 'status', '--porcelain'), '');
	assertNoLeftovers(t, dir);

	git(dir, 'apply', ...result.patches.map(patch => patch.patchPath));
	t.is(read(dir, 'src/b/two.ts'), 'export const two = 22;\n');
	t.regex(formatSwarmSummary(config(), result), /git apply .*\*\.patch/);
});

test('yolo mode applies new, binary, deleted and moved files', async t => {
	const dir = createRepo(t);
	const binary = Buffer.from([0, 1, 2, 3, 0, 255]);
	const result = await runSwarm(
		config({swarmMode: 'yolo'}),
		dependencies(dir, {
			a: worktree => {
				write(worktree, 'src/a/image.bin', binary);
				write(worktree, 'src/a/new file é.ts', 'new\n');
				git(worktree, 'mv', 'src/a/one.ts', 'src/a/moved.ts');
			},
			b: worktree => rmSync(join(worktree, 'src/b/two.ts')),
		}),
	);

	t.is(result.status, 'complete', result.error);
	t.true(result.applied);
	t.deepEqual(readFileSync(join(dir, 'src/a/image.bin')), binary);
	t.is(read(dir, 'src/a/new file é.ts'), 'new\n');
	t.true(existsSync(join(dir, 'src/a/moved.ts')));
	t.false(existsSync(join(dir, 'src/a/one.ts')));
	t.false(existsSync(join(dir, 'src/b/two.ts')));
	assertNoLeftovers(t, dir);
});

test('runtime entries a worker adds to .nanocoder/.gitignore are left out', async t => {
	for (const tracked of [false, true]) {
		const dir = createRepo(t);
		if (tracked) {
			write(dir, '.nanocoder/.gitignore', '/mine/\n');
			git(dir, 'add', '.');
			git(dir, 'commit', '-qm', 'gitignore');
		}
		const result = await runSwarm(
			config({swarmMode: 'yolo'}),
			dependencies(dir, {
				a: async worktree => {
					await ensureNanocoderGitignore(worktree);
					write(worktree, '.nanocoder/plans/p.json', '{}');
					write(worktree, 'src/a/one.ts', 'edited\n');
				},
				b: worktree => ensureNanocoderGitignore(worktree),
			}),
		);

		t.is(result.status, 'complete', result.error);
		t.deepEqual(
			result.patches.map(patch => patch.files),
			[['src/a/one.ts']],
		);
		t.is(git(dir, 'status', '--porcelain'), ' M src/a/one.ts\n');
	}
});

test('a worker that changes nothing does not fail the run', async t => {
	const dir = createRepo(t);
	const result = await runSwarm(
		config({swarmMode: 'yolo'}),
		dependencies(dir, {a: editBoth.a as Behaviour}),
	);

	t.is(result.status, 'complete', result.error);
	t.deepEqual(
		result.patches.map(patch => patch.id),
		['a'],
	);
	t.is(read(dir, 'src/a/one.ts'), 'export const one = 11;\n');
});

test('commits made by a worker are included in its patch', async t => {
	const dir = createRepo(t);
	const result = await runSwarm(
		config({swarmMode: 'yolo'}),
		dependencies(dir, {
			a: worktree => {
				write(worktree, 'src/a/one.ts', 'committed\n');
				git(worktree, 'commit', '-qam', 'worker commit');
			},
		}),
	);

	t.is(result.status, 'complete', result.error);
	t.is(read(dir, 'src/a/one.ts'), 'committed\n');
});

test('apply mode applies only after confirmation', async t => {
	for (const approve of [true, false]) {
		const dir = createRepo(t);
		const statuses: string[] = [];
		const result = await runSwarm(
			config({swarmMode: 'apply'}),
			dependencies(dir, editBoth, {
				onUpdate: snapshot => statuses.push(snapshot.status),
				confirmApply: async () => approve,
			}),
		);

		t.is(result.status, 'complete', result.error);
		t.true(statuses.includes('awaiting-confirmation'));
		t.is(result.applied, approve);
		t.is(
			read(dir, 'src/a/one.ts'),
			`export const one = ${approve ? 11 : 1};\n`,
		);
	}
});

test('a change outside the scope fails the run and applies nothing', async t => {
	const dir = createRepo(t);
	const result = await runSwarm(
		config({swarmMode: 'yolo'}),
		dependencies(dir, {
			a: editBoth.a as Behaviour,
			b: worktree => write(worktree, 'src/a/other.ts', 'intruder\n'),
		}),
	);

	t.is(result.status, 'failed');
	t.regex(result.error ?? '', /Scope violation: worker b changed src\/a\/other/);
	t.deepEqual(
		result.patches.map(patch => patch.id),
		['a'],
	);
	t.is(git(dir, 'status', '--porcelain'), '');
	assertNoLeftovers(t, dir);
});

test('moving a file out of another scope is a violation', async t => {
	const dir = createRepo(t);
	const result = await runSwarm(
		config(),
		dependencies(dir, {
			a: worktree => git(worktree, 'mv', 'src/b/two.ts', 'src/a/two.ts'),
		}),
	);

	t.is(result.status, 'failed');
	t.regex(result.error ?? '', /changed src\/b\/two\.ts/);
});

test('a failed worker stops the others and never touches user files', async t => {
	const dir = createRepo(t);
	const result = await runSwarm(
		config({swarmMode: 'review'}),
		dependencies(dir, {
			a: (_worktree, signal) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(new Error('stopped')));
				}),
			b: () => {
				// The user keeps working while the swarm runs.
				write(dir, 'src/a/one.ts', 'user edit\n');
				write(dir, 'notes.txt', 'user notes\n');
				throw new Error('model unavailable');
			},
		}),
	);

	t.is(result.status, 'failed');
	t.regex(result.error ?? '', /Worker b failed: model unavailable/);
	t.deepEqual(
		result.workers.map(worker => worker.status),
		['cancelled', 'failed'],
	);
	t.is(read(dir, 'src/a/one.ts'), 'user edit\n');
	t.is(read(dir, 'notes.txt'), 'user notes\n');
	t.true(existsSync(join(dir, result.runDir ?? '', 'error.log')));
	assertNoLeftovers(t, dir);
});

test('nothing is applied if the tree changed during the run', async t => {
	const dir = createRepo(t);
	const result = await runSwarm(
		config({swarmMode: 'yolo'}),
		dependencies(dir, {
			...editBoth,
			b: worktree => {
				editBoth.b?.(worktree, new AbortController().signal);
				write(dir, 'notes.txt', 'user notes\n');
			},
		}),
	);

	t.is(result.status, 'failed');
	t.regex(result.error ?? '', /changed while swarm was running/);
	t.is(result.patches.length, 2);
	t.is(read(dir, 'src/a/one.ts'), 'export const one = 1;\n');
	t.is(read(dir, 'notes.txt'), 'user notes\n');
});

test('cancelling removes the worktrees', async t => {
	const dir = createRepo(t);
	const cancel = new AbortController();
	const result = await runSwarm(
		config(),
		dependencies(
			dir,
			{
				a: (_worktree, signal) =>
					new Promise((_resolve, reject) => {
						signal.addEventListener('abort', () => reject(new Error('x')));
						cancel.abort();
					}),
			},
			{signal: cancel.signal},
		),
	);

	t.is(result.status, 'failed');
	t.is(result.error, 'Swarm cancelled.');
	assertNoLeftovers(t, dir);
});

test('the time limit stops the workers', async t => {
	const dir = createRepo(t);
	const hang: Behaviour = (_worktree, signal) =>
		new Promise((_resolve, reject) => {
			const keepAlive = setTimeout(() => undefined, 10_000);
			signal.addEventListener('abort', () => {
				clearTimeout(keepAlive);
				reject(new Error('x'));
			});
		});
	const result = await runSwarm(
		config({timeoutMs: 1500}),
		dependencies(dir, {a: hang, b: hang}),
	);

	t.is(result.status, 'failed');
	t.regex(result.error ?? '', /timed out/);
	assertNoLeftovers(t, dir);
});

test('refuses a dirty tree before asking the model', async t => {
	const dir = createRepo(t);
	write(dir, 'dirty.txt', 'x');
	const {client, seen} = planClient(TWO_TASKS);
	const result = await runSwarm(config(), dependencies(dir, {}, {client}));

	t.is(result.status, 'failed');
	t.regex(result.error ?? '', /not clean/);
	t.is(seen.length, 0);
	t.is(read(dir, 'dirty.txt'), 'x');
});

test('refuses to run from a subdirectory or outside a repository', async t => {
	const dir = createRepo(t);
	const nested = await runSwarm(
		config(),
		dependencies(join(dir, 'src'), {}),
	);
	t.regex(nested.error ?? '', /from the repository root/);

	const plain = mkdtempSync(join(tmpdir(), 'nanocoder-plain-'));
	t.teardown(() => rmSync(plain, {recursive: true, force: true}));
	const outside = await runSwarm(config(), dependencies(plain, {}));
	t.regex(outside.error ?? '', /inside a Git repository/);
});

test('a rejected plan is retried with the reason, and files are listed', async t => {
	const dir = createRepo(t);
	const overlapping = JSON.stringify({
		tasks: [
			{id: 'a', description: 'x', fileScope: ['src/']},
			{id: 'b', description: 'y', fileScope: ['src/b']},
		],
	});
	const {client, seen} = planClient(
		overlapping,
		`Here you go:\n\`\`\`json\n${TWO_TASKS}\n\`\`\``,
	);
	const result = await runSwarm(
		config(),
		dependencies(dir, editBoth, {client}),
	);

	t.is(result.status, 'complete', result.error);
	t.is(seen.length, 2);
	t.regex(seen[0]?.[1]?.content ?? '', /src\/a\/one\.ts/);
	t.regex(seen[1]?.at(-1)?.content ?? '', /Overlap detected/);
});

test('gives up after three unusable plans without creating anything', async t => {
	const dir = createRepo(t);
	const {client, seen} = planClient('no idea');
	const result = await runSwarm(config(), dependencies(dir, {}, {client}));

	t.is(result.status, 'failed');
	t.is(seen.length, 3);
	t.false(existsSync(join(dir, '.nanocoder')));
});

test('workers get scoped arguments, the goal and ignored local config', async t => {
	const dir = createRepo(t);
	write(dir, 'agents.config.json', '{}');
	const calls: Array<{args: string[]; hasConfig: boolean}> = [];
	const result = await runSwarm(
		config({swarmMode: 'apply'}),
		dependencies(dir, {}, {
			workerOptions: ['--provider', 'Local', '--model', 'm'],
			runWorker: async options => {
				calls.push({
					args: options.cliArgs,
					hasConfig: existsSync(join(options.cwd, 'agents.config.json')),
				});
				options.onEvent({type: 'turn'});
				options.onEvent({type: 'tool', tool: 'read_file'});
				return {tokens: 3};
			},
		}),
	);

	t.is(result.status, 'complete', result.error);
	t.is(result.patches.length, 0);
	t.true(calls.every(call => call.hasConfig));
	const args = calls[0]?.args ?? [];
	t.is(args[args.indexOf('--mode') + 1], 'auto-accept');
	t.is(args[args.indexOf('--restricted-scope') + 1], 'src/a');
	t.is(args[args.indexOf('--provider') + 1], 'Local');
	t.regex(args.at(-1) ?? '', /Overall goal: update both modules/);
	t.is(result.workers[0]?.turns, 1);
});

test('a second run keeps the patches of the first', async t => {
	const dir = createRepo(t);
	const snapshots: SwarmSnapshot[] = [];
	for (let run = 0; run < 2; run++) {
		snapshots.push(await runSwarm(config(), dependencies(dir, editBoth)));
	}

	t.deepEqual(
		snapshots.map(snapshot => snapshot.status),
		['complete', 'complete'],
	);
	t.not(snapshots[0]?.runDir, snapshots[1]?.runDir);
	for (const snapshot of snapshots) {
		for (const patch of snapshot.patches) {
			t.true(existsSync(join(dir, patch.patchPath)));
		}
	}
});
