import test from 'ava';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setProjectRoot} from '@/services/session-cwd';
import {
	buildReviewJsonReport,
	runHeadlessReview,
} from './headless-review.js';
import type {DefaultReviewResult} from './run-default-review.js';
import type {ReviewFinding} from './finding-format.js';

console.log('\nheadless-review.spec.ts');

// Citation validation resolves findings against the project root, so point
// it at a temp project containing sample.ts.
const projectRoot = mkdtempSync(join(tmpdir(), 'nc-headless-review-'));
writeFileSync(join(projectRoot, 'sample.ts'), 'added\nmore\n');
setProjectRoot(projectRoot);

const finding: ReviewFinding = {
	id: 'F1',
	file: 'sample.ts',
	line: 2,
	severity: 'high',
	issue: 'readFileSync undefined',
	evidence: 'return readFileSync(path);',
};

const pipelineResult = (): DefaultReviewResult => ({
	confirmed: [finding],
	dropped: [
		{
			finding: {...finding, id: 'F2', issue: 'another claim'},
			verdict: 'REJECT',
			reason: 'guarded upstream',
		},
	],
	notes: ['standards finder reported no issues'],
	usage: {finder: 100, verifier: 50},
});

const okDiff = {
	ok: true as const,
	diff: 'diff --git a/sample.ts b/sample.ts\n+++ b/sample.ts\n@@ -1 +1,2 @@\n+added\n',
	targetDescription: 'main...feature',
};

const fakeClient = {
	chat: async () => ({
		choices: [{message: {content: 'One-shot review output.'}}],
	}),
} as never;

/** Wire a scripted executor for agentic-tier tests; restores in finally. */
async function withExecutor(
	run: () => Promise<void>,
): Promise<void> {
	const {getAgentToolExecutor, setAgentToolExecutor} = await import(
		'@/tools/agent-tool'
	);
	const previous = getAgentToolExecutor();
	setAgentToolExecutor({
		execute: async task => {
			const findingMatch = /ID: (F\d+)/.exec(task.prompt ?? '');
			return {
				subagentName: task.subagent_type,
				output: findingMatch
					? `VERDICT: CONFIRM\nID: ${findingMatch[1]}\nREASON: proven`
					: [
							'FINDING',
							'FILE: sample.ts',
							'LINE: 1',
							'SEVERITY: high',
							'ISSUE: pipeline finding',
							'EVIDENCE: added line',
							'END',
						].join('\n'),
				success: true,
				tokensUsed: 7,
				executionTimeMs: 1,
			};
		},
	} as never);
	try {
		await run();
	} finally {
		setAgentToolExecutor(previous as never);
	}
}

test('buildReviewJsonReport - maps the pipeline result to the JSON contract', t => {
	const report = buildReviewJsonReport(pipelineResult(), 'default', 'main...feature');
	t.is(report.tier, 'default');
	t.is(report.target, 'main...feature');
	t.is(report.confirmed.length, 1);
	t.deepEqual(report.confirmed[0], {
		id: 'F1',
		file: 'sample.ts',
		line: 2,
		severity: 'high',
		issue: 'readFileSync undefined',
		evidence: 'return readFileSync(path);',
	});
	t.is(report.dropped.length, 1);
	t.is(report.dropped[0].verdict, 'REJECT');
	t.is(report.dropped[0].reason, 'guarded upstream');
	t.deepEqual(report.usage, {finder: 100, verifier: 50});
	t.is(
		JSON.parse(JSON.stringify(report)) && typeof JSON.stringify(report),
		'string',
	);
});

test('runHeadlessReview - text mode renders the markdown report', async t => {
	await withExecutor(async () => {
		const outcome = await runHeadlessReview(
			{
				args: ['feature'],
				client: fakeClient,
				resolveDiff: async () => okDiff,
			},
			'text',
		);

		t.is(outcome.exitCode, 0);
		t.true(outcome.stdout.includes('Verified findings'));
		t.true(outcome.stdout.includes('pipeline finding'));
		t.true(outcome.stdout.includes('Approximate token usage'));
	});
});

test('runHeadlessReview - json mode emits the JSON document only', async t => {
	await withExecutor(async () => {
		const outcome = await runHeadlessReview(
			{
				args: ['feature'],
				client: fakeClient,
				resolveDiff: async () => okDiff,
			},
			'json',
		);

		t.is(outcome.exitCode, 0);
		const parsed = JSON.parse(outcome.stdout);
		t.is(parsed.tier, 'default');
		t.is(parsed.confirmed.length, 1);
		t.is(parsed.usage.finder, 7);
		t.false(outcome.stdout.includes('Verified findings'), 'no markdown mixed in');
	});
});

test('runHeadlessReview - deep tier label reaches the JSON report', async t => {
	const {getAgentToolExecutor, setAgentToolExecutor} = await import(
		'@/tools/agent-tool'
	);
	const previous = getAgentToolExecutor();
	setAgentToolExecutor({
		execute: async () => ({
			subagentName: 'x',
			output: '',
			success: true,
			executionTimeMs: 1,
		}),
	} as never);

	try {
		const outcome = await runHeadlessReview(
			{
				args: ['deep', 'feature'],
				client: fakeClient,
				resolveDiff: async () => okDiff,
			},
			'json',
		);
		t.is(outcome.exitCode, 0);
		const parsed = JSON.parse(outcome.stdout);
		t.is(parsed.tier, 'deep');
	} finally {
		if (previous) {
			setAgentToolExecutor(previous);
		}
	}
});

test('runHeadlessReview - quick tier runs the one-shot pass with no executor', async t => {
	const {getAgentToolExecutor, setAgentToolExecutor} = await import(
		'@/tools/agent-tool'
	);
	const previous = getAgentToolExecutor();
	setAgentToolExecutor(null as never);

	try {
		const outcome = await runHeadlessReview(
			{
				args: ['quick', 'feature'],
				client: fakeClient,
				resolveDiff: async () => okDiff,
			},
			'text',
		);
		t.is(outcome.exitCode, 0);
		t.true(outcome.stdout.includes('One-shot review output.'));
	} finally {
		if (previous) {
			setAgentToolExecutor(previous);
		}
	}
});

test('runHeadlessReview - failed target resolution exits 1 with empty stdout', async t => {
	const outcome = await runHeadlessReview(
		{
			args: ['feature'],
			client: fakeClient,
			resolveDiff: async () => ({ok: false, error: 'no such branch'}),
		},
		'text',
	);

	t.is(outcome.exitCode, 1);
	t.is(outcome.stdout, '');
});
