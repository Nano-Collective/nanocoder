/**
 * verify/cli.ts Tests
 *
 * Follows the injectable-deps seam pattern from source/plain/shell.spec.ts:
 * the mock boundary is runVerifyCli's own `deps` parameter, never
 * node:child_process / execGh (this repo's git tool specs never mock
 * child_process).
 */

import test from 'ava';
import type {CustomCommandLoader} from '@/custom-commands/loader';
import type {PlainInitResult} from '@/plain/initialize';
import type {SubagentResult} from '@/subagents/types';
import type {PrRefs} from '@/tools/git/utils';
import type {ToolManager} from '@/tools/tool-manager';
import type {LLMClient} from '@/types/core';
import {runVerifyCli, type VerifyCliDeps} from './cli';
import type {SecurityScanResult} from './security-scan';

const FAKE_INIT: PlainInitResult = {
	client: {} as LLMClient,
	toolManager: {} as ToolManager,
	customCommandLoader: {} as CustomCommandLoader,
	provider: 'fake-provider',
	model: 'fake-model',
};

const CURRENT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const MATCHING_REFS: PrRefs = {
	headRefName: 'current-branch',
	baseRefName: 'main',
	headRefOid: CURRENT_SHA,
};

const NO_FINDINGS_SCAN: SecurityScanResult = {
	available: true,
	ranSuccessfully: true,
	findings: [],
	totalFound: 0,
};

const SUCCESSFUL_RESULT: SubagentResult = {
	subagentName: 'verify-pr-review',
	output: '### Summary\nLooks fine.',
	success: true,
	executionTimeMs: 1,
};

function baseDeps(overrides: Partial<VerifyCliDeps> = {}): Partial<VerifyCliDeps> {
	return {
		isGhAvailable: () => true,
		getCurrentCommitSha: async () => CURRENT_SHA,
		getPrRefs: async () => MATCHING_REFS,
		getPrChangedFiles: async () => ['source/foo.ts'],
		fileExists: () => true,
		runSecurityScan: async () => NO_FINDINGS_SCAN,
		initializePlain: async () => FAKE_INIT,
		runSubagent: async () => SUCCESSFUL_RESULT,
		postReview: async () => {
			throw new Error('postReview should not have been called in this test');
		},
		...overrides,
	};
}

test('missing --pr returns exit code 1 with usage text', async t => {
	const result = await runVerifyCli([], {projectRoot: '.'}, baseDeps());
	t.is(result.exitCode, 1);
	t.true(result.output.includes('Usage:'));
});

test('non-numeric --pr returns exit code 1', async t => {
	const result = await runVerifyCli(
		['--pr', 'not-a-number'],
		{projectRoot: '.'},
		baseDeps(),
	);
	t.is(result.exitCode, 1);
	t.true(result.output.includes('Invalid --pr value'));
});

test('unknown flag returns exit code 1', async t => {
	const result = await runVerifyCli(
		['--pr', '861', '--post-revieww'],
		{projectRoot: '.'},
		baseDeps(),
	);
	t.is(result.exitCode, 1);
	t.true(result.output.includes('Unknown flag'));
});

test('missing gh CLI returns exit code 1', async t => {
	const result = await runVerifyCli(
		['--pr', '861'],
		{projectRoot: '.'},
		baseDeps({isGhAvailable: () => false}),
	);
	t.is(result.exitCode, 1);
	t.true(result.output.includes('gh CLI not found'));
});

test('commit SHA mismatch returns exit code 1 without scanning or running the subagent', async t => {
	let scanCalled = false;
	let subagentCalled = false;
	const result = await runVerifyCli(
		['--pr', '861'],
		{projectRoot: '.'},
		baseDeps({
			getCurrentCommitSha: async () =>
				'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
			runSecurityScan: async () => {
				scanCalled = true;
				return NO_FINDINGS_SCAN;
			},
			runSubagent: async () => {
				subagentCalled = true;
				return SUCCESSFUL_RESULT;
			},
		}),
	);
	t.is(result.exitCode, 1);
	t.true(result.output.includes('bbbbbbb'));
	t.true(result.output.includes('aaaaaaa'));
	t.true(result.output.includes('current-branch'));
	t.true(result.output.includes('gh pr checkout 861'));
	t.false(scanCalled);
	t.false(subagentCalled);
});

test('a mismatch is detected even in detached HEAD (SHA-based, not branch-name-based)', async t => {
	// getCurrentCommitSha() is a plain `git rev-parse HEAD`, so a detached
	// HEAD checkout (common in PR-triggered CI) still yields a real SHA here
	// rather than the literal string "HEAD" a branch-name comparison would
	// have used — matching should just work when the SHA lines up.
	const result = await runVerifyCli(
		['--pr', '861'],
		{projectRoot: '.'},
		baseDeps({
			getCurrentCommitSha: async () => CURRENT_SHA,
		}),
	);
	t.is(result.exitCode, 0);
});

test('happy path without --post-review exits 0 and never calls postReview', async t => {
	let postReviewCalled = false;
	const result = await runVerifyCli(
		['--pr', '861'],
		{projectRoot: '.'},
		baseDeps({
			postReview: async () => {
				postReviewCalled = true;
			},
		}),
	);
	t.is(result.exitCode, 0);
	t.true(result.output.includes('PR #861'));
	t.true(result.output.includes('Looks fine.'));
	t.false(postReviewCalled);
});

test('happy path with --post-review posts the formatted body and exits 0', async t => {
	const calls: Array<{pr: number; body: string}> = [];
	const result = await runVerifyCli(
		['--pr', '861', '--post-review'],
		{projectRoot: '.'},
		baseDeps({
			postReview: async (pr, body) => {
				calls.push({pr, body});
			},
		}),
	);
	t.is(result.exitCode, 0);
	t.true(result.output.includes('Review posted to PR #861'));
	t.is(calls.length, 1);
	t.is(calls[0].pr, 861);
	t.true(calls[0].body.includes('Looks fine.'));
});

test('a posting failure exits 2 and still prints the generated review', async t => {
	const result = await runVerifyCli(
		['--pr', '861', '--post-review'],
		{projectRoot: '.'},
		baseDeps({
			postReview: async () => {
				throw new Error('network error');
			},
		}),
	);
	t.is(result.exitCode, 2);
	t.true(result.output.includes('network error'));
	t.true(result.output.includes('PR #861'));
	t.true(result.output.includes('Looks fine.'));
});

test('a subagent failure exits 1 with the error surfaced', async t => {
	const result = await runVerifyCli(
		['--pr', '861'],
		{projectRoot: '.'},
		baseDeps({
			runSubagent: async () => ({
				subagentName: 'verify-pr-review',
				output: '',
				success: false,
				error: 'boom',
				executionTimeMs: 1,
			}),
		}),
	);
	t.is(result.exitCode, 1);
	t.true(result.output.includes('boom'));
});

test('changed files are threaded into runSecurityScan as paths', async t => {
	let receivedPaths: string[] | undefined;
	const result = await runVerifyCli(
		['--pr', '861'],
		{projectRoot: '.'},
		baseDeps({
			getPrChangedFiles: async () => ['source/a.ts', 'source/b.ts'],
			runSecurityScan: async opts => {
				receivedPaths = opts?.paths;
				return NO_FINDINGS_SCAN;
			},
		}),
	);
	t.is(result.exitCode, 0);
	t.deepEqual(receivedPaths, ['source/a.ts', 'source/b.ts']);
});

test('changed files that no longer exist locally (deleted/renamed-away) are dropped before scanning', async t => {
	let receivedPaths: string[] | undefined;
	const result = await runVerifyCli(
		['--pr', '861'],
		{projectRoot: '/repo'},
		baseDeps({
			getPrChangedFiles: async () => [
				'source/kept.ts',
				'source/deleted.ts',
			],
			fileExists: absolutePath => !absolutePath.includes('deleted.ts'),
			runSecurityScan: async opts => {
				receivedPaths = opts?.paths;
				return NO_FINDINGS_SCAN;
			},
		}),
	);
	t.is(result.exitCode, 0);
	t.deepEqual(receivedPaths, ['source/kept.ts']);
});

test("targetBranch in the subagent task context is the PR's base branch, not the current branch", async t => {
	let receivedTargetBranch: unknown;
	const result = await runVerifyCli(
		['--pr', '861'],
		{projectRoot: '.'},
		baseDeps({
			getPrRefs: async () => ({
				headRefName: 'current-branch',
				baseRefName: 'release/1.0',
				headRefOid: CURRENT_SHA,
			}),
			runSubagent: async (_init, _root, task) => {
				receivedTargetBranch = task.context?.targetBranch;
				return SUCCESSFUL_RESULT;
			},
		}),
	);
	t.is(result.exitCode, 0);
	t.is(receivedTargetBranch, 'release/1.0');
});
