import test from 'ava';
import type {CiJobFailedPayload} from '@/events/types';
import type {SubagentTask} from '@/subagents/types';
import type {CiFixWorktree} from './ci-fix-worktree';
import {
	buildFixRunnerEnv,
	type CiFixOrchestratorDeps,
	type PublishBranchOptions,
	publishFromClone,
	runCiAutoFixFlow,
} from './ci-fix-orchestrator';
import type {CiFixRunnerInput} from './ci-fix-runner';

console.log('\nci-fix-orchestrator.spec.ts');

const PAYLOAD: CiJobFailedPayload = {
	runId: 42,
	workflowName: 'CI',
	branch: 'feature-x',
	headSha: 'abc123',
	url: 'https://github.com/o/r/actions/runs/42',
};

function ciTask(): SubagentTask {
	return {
		subagent_type: 'verify-ci-investigator',
		description: 'Investigate CI failure',
		context: {
			trigger: {type: 'event', kind: 'ci.job.failed', payload: PAYLOAD},
		},
	};
}

const FAKE_WORKTREE: CiFixWorktree = {
	path: '/tmp/fake-worktree',
	branch: 'nanocoder/ci-fix/feature-x-42',
	isNewBranch: true,
};

function stubDeps(
	overrides: Partial<CiFixOrchestratorDeps> = {},
	fixedShas: string[] = [],
) {
	const calls = {
		recorded: [] as string[],
		createWorktree: 0,
		removeWorktree: 0,
		spawnFixRunner: 0,
		publishBranch: [] as PublishBranchOptions[],
		runnerInputs: [] as CiFixRunnerInput[],
		createDraftPr: [] as Array<{title: string; body: string; base: string; head: string}>,
	};
	const deps: CiFixOrchestratorDeps = {
		createWorktree: async () => {
			calls.createWorktree++;
			return FAKE_WORKTREE;
		},
		removeWorktree: async () => {
			calls.removeWorktree++;
		},
		spawnFixRunner: async () => {
			calls.spawnFixRunner++;
			return {success: true, committed: false, commitShas: [], output: 'no fix needed'};
		},
		stageFailedLog: async () => '.git/nanocoder-ci/failed-steps.log',
		publishBranch: async opts => {
			calls.publishBranch.push(opts);
		},
		createDraftPr: async opts => {
			calls.createDraftPr.push(opts);
			return 'https://github.com/o/r/pull/99';
		},
		readAutoFixedShas: async () => fixedShas,
		recordAutoFixedShas: async (_root, shas) => {
			calls.recorded.push(...shas);
		},
		...overrides,
	};
	return {deps, calls};
}

test('no ci.job.failed payload on the task fails immediately without creating a worktree', async t => {
	const {deps, calls} = stubDeps();
	const task: SubagentTask = {
		subagent_type: 'verify-ci-investigator',
		description: 'no payload',
	};

	const result = await runCiAutoFixFlow(task, 'auto-fix', '/repo', deps);

	t.false(result.success);
	t.is(calls.createWorktree, 0);
});

test('createWorktree throwing is a clean failure, no removeWorktree call', async t => {
	const {deps, calls} = stubDeps({
		createWorktree: async () => {
			throw new Error('git clone failed: could not resolve host');
		},
	});

	const result = await runCiAutoFixFlow(ciTask(), 'full-commit', '/repo', deps);

	t.false(result.success);
	t.regex(result.error ?? '', /Failed to create CI-fix worktree/);
	t.is(calls.removeWorktree, 0);
});

test('runner failure returns a failed result, worktree still removed', async t => {
	const {deps, calls} = stubDeps({
		spawnFixRunner: async () => ({
			success: false,
			committed: false,
			commitShas: [],
			output: '',
			error: 'subagent crashed',
		}),
	});

	const result = await runCiAutoFixFlow(ciTask(), 'auto-fix', '/repo', deps);

	t.false(result.success);
	t.regex(result.error ?? '', /subagent crashed/);
	t.is(calls.removeWorktree, 1);
	t.is(calls.publishBranch.length, 0);
});

test('committed: false returns a successful result with no push/PR call', async t => {
	const {deps, calls} = stubDeps();

	const result = await runCiAutoFixFlow(ciTask(), 'auto-fix', '/repo', deps);

	t.true(result.success);
	t.is(result.output, 'no fix needed');
	t.is(calls.publishBranch.length, 0);
	t.is(calls.createDraftPr.length, 0);
	t.is(calls.removeWorktree, 1);
});

test('auto-fix + committed pushes the fix branch and opens a draft PR against the original branch', async t => {
	const {deps, calls} = stubDeps({
		spawnFixRunner: async () => ({
			success: true,
			committed: true,
			commitShas: ['deadbeef'],
			output: 'fixed the flaky test',
		}),
	});

	const result = await runCiAutoFixFlow(ciTask(), 'auto-fix', '/repo', deps);

	t.true(result.success);
	t.true(result.fixApplied);
	t.is(calls.publishBranch.length, 1);
	t.deepEqual(calls.publishBranch[0], {
		projectRoot: '/repo',
		clonePath: FAKE_WORKTREE.path,
		branch: FAKE_WORKTREE.branch,
		runId: PAYLOAD.runId,
	});
	t.is(calls.createDraftPr.length, 1);
	t.is(calls.createDraftPr[0]?.base, PAYLOAD.branch);
	t.is(calls.createDraftPr[0]?.head, FAKE_WORKTREE.branch);
	t.is(
		result.output.split('\n')[0],
		'Opened draft PR: https://github.com/o/r/pull/99',
	);
	t.deepEqual(calls.recorded, ['deadbeef']);
	t.is(calls.removeWorktree, 1);
});

test('full-commit + committed pushes directly to the branch with no draft PR', async t => {
	const {deps, calls} = stubDeps({
		spawnFixRunner: async () => ({
			success: true,
			committed: true,
			commitShas: ['deadbeef'],
			output: 'fixed the flaky test',
		}),
	});

	const result = await runCiAutoFixFlow(ciTask(), 'full-commit', '/repo', deps);

	t.true(result.success);
	t.true(result.fixApplied);
	t.is(calls.publishBranch.length, 1);
	t.is(calls.publishBranch[0]?.branch, FAKE_WORKTREE.branch);
	t.is(calls.publishBranch[0]?.clonePath, FAKE_WORKTREE.path);
	t.is(calls.createDraftPr.length, 0);
	t.is(calls.removeWorktree, 1);
});

test('worktree is still removed when createDraftPr throws after a successful commit', async t => {
	const {deps, calls} = stubDeps({
		spawnFixRunner: async () => ({
			success: true,
			committed: true,
			commitShas: ['deadbeef'],
			output: 'fixed it',
		}),
		createDraftPr: async () => {
			throw new Error('gh pr create failed: no auth');
		},
	});

	const result = await runCiAutoFixFlow(ciTask(), 'auto-fix', '/repo', deps);

	t.false(result.success);
	t.regex(result.error ?? '', /opening a PR for pushed branch "nanocoder\/ci-fix\/feature-x-42" failed/);
	t.is(calls.removeWorktree, 1);
});

test('a failure before the push (no createDraftPr call yet) reports "pushing the fix failed", not the branch-specific wording', async t => {
	const {deps, calls} = stubDeps({
		spawnFixRunner: async () => ({
			success: true,
			committed: true,
			commitShas: ['deadbeef'],
			output: 'fixed it',
		}),
		publishBranch: async () => {
			throw new Error('network unreachable');
		},
	});

	const result = await runCiAutoFixFlow(ciTask(), 'auto-fix', '/repo', deps);

	t.false(result.success);
	t.regex(result.error ?? '', /Fix was committed but pushing the fix failed/);
	t.is(calls.createDraftPr.length, 0);
	t.is(calls.removeWorktree, 1);
});

test('a failing run on a commit the daemon already published as a fix is not retried', async t => {
	const {deps, calls} = stubDeps({}, [PAYLOAD.headSha]);

	const result = await runCiAutoFixFlow(ciTask(), 'full-commit', '/repo', deps);

	t.false(result.success);
	t.regex(result.error ?? '', /needs a human/);
	t.is(calls.createWorktree, 0);
	t.is(calls.spawnFixRunner, 0);
});

test('an already-aborted signal skips the run entirely', async t => {
	const {deps, calls} = stubDeps();
	const controller = new AbortController();
	controller.abort();

	const result = await runCiAutoFixFlow(
		ciTask(),
		'auto-fix',
		'/repo',
		deps,
		controller.signal,
	);

	t.false(result.success);
	t.is(calls.createWorktree, 0);
});

test('abort during the runner skips push/PR and still removes the clone', async t => {
	const controller = new AbortController();
	const {deps, calls} = stubDeps({
		spawnFixRunner: async () => {
			controller.abort();
			return {
				success: true,
				committed: true,
				commitShas: ['deadbeef'],
				output: 'committed before shutdown',
			};
		},
	});

	const result = await runCiAutoFixFlow(
		ciTask(),
		'full-commit',
		'/repo',
		deps,
		controller.signal,
	);

	t.false(result.success);
	t.is(calls.publishBranch.length, 0);
	t.is(calls.createDraftPr.length, 0);
	t.is(calls.recorded.length, 0);
	t.is(calls.removeWorktree, 1);
});

test('full-commit records the published commit SHAs', async t => {
	const {deps, calls} = stubDeps({
		spawnFixRunner: async () => ({
			success: true,
			committed: true,
			commitShas: ['c0ffee'],
			output: 'fixed',
		}),
	});

	await runCiAutoFixFlow(ciTask(), 'full-commit', '/repo', deps);

	t.deepEqual(calls.recorded, ['c0ffee']);
});

// ============================================================================
// The fix runner gets no git/gh credentials; publishing happens here.
// ============================================================================

const RUNNER_IO = {
	ghConfigDir: '/tmp/io/gh-config',
	inputPath: '/tmp/io/input.json',
	resultPath: '/tmp/io/result.json',
};

test('buildFixRunnerEnv strips git/gh credential vectors', t => {
	const env = buildFixRunnerEnv(
		{
			PATH: '/usr/bin',
			HOME: '/home/u',
			GH_TOKEN: 'gho_x',
			GITHUB_TOKEN: 'ghs_x',
			GH_ENTERPRISE_TOKEN: 'e1',
			GITHUB_ENTERPRISE_TOKEN: 'e2',
			GITHUB_PAT: 'p1',
			GH_PAT: 'p2',
			GITHUB_APP_TOKEN: 'p3',
			SSH_AUTH_SOCK: '/tmp/agent.sock',
			SSH_AGENT_PID: '123',
			GIT_ASKPASS: '/usr/bin/askpass',
			SSH_ASKPASS: '/usr/bin/ssh-askpass',
			GIT_SSH: '/usr/bin/ssh',
			GIT_CONFIG_PARAMETERS: "'credential.helper'='store'",
			GIT_CONFIG_KEY_5: 'credential.helper',
			GIT_CONFIG_VALUE_5: 'store',
			GH_CONFIG_DIR: '/home/u/.config/gh',
		},
		RUNNER_IO,
	);

	for (const name of [
		'GH_TOKEN',
		'GITHUB_TOKEN',
		'GH_ENTERPRISE_TOKEN',
		'GITHUB_ENTERPRISE_TOKEN',
		'GITHUB_PAT',
		'GH_PAT',
		'GITHUB_APP_TOKEN',
		'SSH_AUTH_SOCK',
		'SSH_AGENT_PID',
		'SSH_ASKPASS',
		'GIT_SSH',
		'GIT_CONFIG_PARAMETERS',
		'GIT_CONFIG_KEY_5',
		'GIT_CONFIG_VALUE_5',
	]) {
		t.false(name in env, `${name} must not reach the runner`);
	}
	t.is(env.GH_CONFIG_DIR, RUNNER_IO.ghConfigDir, 'gh reads an empty config dir');
});

test('buildFixRunnerEnv keeps unrelated env (provider API keys) and sets push-blocking git config', t => {
	const env = buildFixRunnerEnv(
		{PATH: '/usr/bin', OPENROUTER_API_KEY: 'sk-or-1', ANTHROPIC_API_KEY: 'a'},
		RUNNER_IO,
	);

	t.is(env.PATH, '/usr/bin');
	t.is(env.OPENROUTER_API_KEY, 'sk-or-1');
	t.is(env.ANTHROPIC_API_KEY, 'a');
	t.is(env.GIT_TERMINAL_PROMPT, '0');
	t.is(env.GIT_ASKPASS, 'false');
	t.is(env.GIT_SSH_COMMAND, 'false');
	t.is(env.GIT_CONFIG_NOSYSTEM, '1');
	t.is(env.GH_PROMPT_DISABLED, '1');

	const count = Number(env.GIT_CONFIG_COUNT);
	const config: Record<string, string | undefined> = {};
	for (let i = 0; i < count; i++) {
		config[env[`GIT_CONFIG_KEY_${i}`] ?? ''] = env[`GIT_CONFIG_VALUE_${i}`];
	}
	t.is(config['credential.helper'], '', 'credential helpers are reset');
	t.regex(config['remote.origin.pushurl'] ?? '', /disabled/);

	t.is(env.NANOCODER_CI_FIX_INPUT_PATH, RUNNER_IO.inputPath);
	t.is(env.NANOCODER_CI_FIX_RESULT_PATH, RUNNER_IO.resultPath);
});

test('the staged failed-step log path is handed to the runner', async t => {
	const {deps, calls} = stubDeps({
		spawnFixRunner: async input => {
			calls.runnerInputs.push(input);
			return {success: true, committed: false, commitShas: [], output: ''};
		},
	});

	await runCiAutoFixFlow(ciTask(), 'auto-fix', '/repo', deps);

	t.is(calls.runnerInputs[0]?.failedLogPath, '.git/nanocoder-ci/failed-steps.log');
});

test('publishFromClone fetches into the project repo and pushes from there, never from the clone', async t => {
	const commands: string[][] = [];
	await publishFromClone(
		{projectRoot: '/repo', clonePath: '/tmp/clone', branch: 'fix-b', runId: 7},
		async args => {
			commands.push(args);
			return '';
		},
	);

	t.is(commands.length, 3);
	for (const args of commands) {
		t.deepEqual(args.slice(0, 2), ['-C', '/repo'], 'every git call runs in the project repo');
	}
	t.deepEqual(commands[0], [
		'-C',
		'/repo',
		'fetch',
		'--no-tags',
		'--no-write-fetch-head',
		'file:///tmp/clone',
		'+refs/heads/fix-b:refs/nanocoder/ci-fix/7',
	]);
	t.deepEqual(commands[1], [
		'-C',
		'/repo',
		'push',
		'--no-verify',
		'origin',
		'refs/nanocoder/ci-fix/7:refs/heads/fix-b',
	]);
	t.deepEqual(commands[2], ['-C', '/repo', 'update-ref', '-d', 'refs/nanocoder/ci-fix/7']);
});

test('publishFromClone removes the temporary ref even when the push fails', async t => {
	const commands: string[][] = [];
	await t.throwsAsync(
		publishFromClone(
			{projectRoot: '/repo', clonePath: '/tmp/clone', branch: 'fix-b', runId: 7},
			async args => {
				commands.push(args);
				if (args[2] === 'push') throw new Error('rejected');
				return '';
			},
		),
		{message: 'rejected'},
	);
	t.is(commands.at(-1)?.[2], 'update-ref');
});

test('the draft PR body is redacted', async t => {
	const {deps, calls} = stubDeps({
		spawnFixRunner: async () => ({
			success: true,
			committed: true,
			commitShas: ['deadbeef'],
			output: 'leaked ghp_abcdefghijklmnopqrstuvwxyz0123456789 in log',
		}),
	});

	await runCiAutoFixFlow(ciTask(), 'auto-fix', '/repo', deps);

	t.notRegex(calls.createDraftPr[0]?.body ?? '', /ghp_/);
	t.regex(calls.createDraftPr[0]?.body ?? '', /\[REDACTED\]/);
});
