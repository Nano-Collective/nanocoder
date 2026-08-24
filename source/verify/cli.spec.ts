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

const NO_FINDINGS_SCAN: SecurityScanResult = {
	available: true,
	ranSuccessfully: true,
	findings: [],
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

test('missing gh CLI returns exit code 1', async t => {
	const result = await runVerifyCli(
		['--pr', '861'],
		{projectRoot: '.'},
		baseDeps({isGhAvailable: () => false}),
	);
	t.is(result.exitCode, 1);
	t.true(result.output.includes('gh CLI not found'));
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
