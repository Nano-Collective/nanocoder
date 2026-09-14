import test from 'ava';
import type {CiJobFailedPayload} from '@/events/types';
import type {SubagentTask} from '@/subagents/types';
import type {CiFixWorktree} from './ci-fix-worktree';
import {runCiAutoFixFlow, type CiFixOrchestratorDeps} from './ci-fix-orchestrator';

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

function stubDeps(overrides: Partial<CiFixOrchestratorDeps> = {}) {
	const calls = {
		createWorktree: 0,
		removeWorktree: 0,
		spawnFixRunner: 0,
		pushBranch: [] as Array<[string, {setUpstream?: boolean; cwd?: string} | undefined]>,
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
		pushBranch: async (branch, opts) => {
			calls.pushBranch.push([branch, opts]);
		},
		createDraftPr: async opts => {
			calls.createDraftPr.push(opts);
			return 'https://github.com/o/r/pull/99';
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
	t.is(calls.pushBranch.length, 0);
});

test('committed: false returns a successful result with no push/PR call', async t => {
	const {deps, calls} = stubDeps();

	const result = await runCiAutoFixFlow(ciTask(), 'auto-fix', '/repo', deps);

	t.true(result.success);
	t.is(result.output, 'no fix needed');
	t.is(calls.pushBranch.length, 0);
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
	t.is(calls.pushBranch.length, 1);
	t.is(calls.pushBranch[0]?.[0], FAKE_WORKTREE.branch);
	t.true(calls.pushBranch[0]?.[1]?.setUpstream);
	t.is(calls.pushBranch[0]?.[1]?.cwd, FAKE_WORKTREE.path);
	t.is(calls.createDraftPr.length, 1);
	t.is(calls.createDraftPr[0]?.base, PAYLOAD.branch);
	t.is(calls.createDraftPr[0]?.head, FAKE_WORKTREE.branch);
	t.true(result.output.includes('https://github.com/o/r/pull/99'));
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
	t.is(calls.pushBranch.length, 1);
	t.is(calls.pushBranch[0]?.[0], FAKE_WORKTREE.branch);
	t.falsy(calls.pushBranch[0]?.[1]?.setUpstream);
	t.is(calls.pushBranch[0]?.[1]?.cwd, FAKE_WORKTREE.path);
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
		pushBranch: async () => {
			throw new Error('network unreachable');
		},
	});

	const result = await runCiAutoFixFlow(ciTask(), 'auto-fix', '/repo', deps);

	t.false(result.success);
	t.regex(result.error ?? '', /Fix was committed but pushing the fix failed/);
	t.is(calls.createDraftPr.length, 0);
	t.is(calls.removeWorktree, 1);
});
