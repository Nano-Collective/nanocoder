import test from 'ava';
import type {Message} from '@/types/core';
import {renderGroundedReviewReport} from './review-report';
import {createReviewMessage, readPersistedReview} from './review-session';
import {
	createScriptedReviewClient,
	findingBlock,
	type ReviewScript,
	verdictBlock,
} from './review-client-test-helpers';
import {
	createReviewFixtureTools,
	createReviewGitFixture,
	type ReviewGitFixture,
} from './review-test-helpers';
import {
	DEFAULT_GROUNDED_REVIEW_BUDGETS,
	type GroundedReviewOptions,
	runGroundedReview,
} from './run-grounded-review';

const CHANGED_SOURCE = [
	'export const value = 1;',
	'export function average(total: number, count: number) {',
	'\treturn total / count;',
	'}',
	'',
].join('\n');

function featureFixture(
	t: {teardown: (fn: () => void) => void},
	extraFiles: Record<string, string> = {},
): ReviewGitFixture {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit(['checkout', '-b', 'feature/grounded']);
	fixture.write('src/file.ts', CHANGED_SOURCE);
	for (const [path, content] of Object.entries(extraFiles)) {
		fixture.write(path, content);
	}
	fixture.runGit(['add', '--all']);
	fixture.runGit(['commit', '-m', 'add average']);
	return fixture;
}

async function review(
	fixture: ReviewGitFixture,
	script: ReviewScript,
	options: Partial<GroundedReviewOptions> = {},
) {
	const {client, calls} = createScriptedReviewClient(script);
	const result = await runGroundedReview({
		request: 'branch feature/grounded',
		client,
		toolMode: {disabled: false, format: 'xml'},
		tools: createReviewFixtureTools(fixture),
		...options,
	});
	return {result, calls, report: renderGroundedReviewReport(result)};
}

const divideFinding = findingBlock({file: 'src/file.ts', line: 3});

test('a truncated finder retains complete findings without completing the review', async t => {
	const fixture = featureFixture(t);
	const {result} = await review(fixture, call =>
		call.role === 'finder'
			? {
					content: `${divideFinding}\nFINDING\nFILE: src/file.ts\nLINE:`,
					finishReason: 'length',
				}
			: {content: verdictBlock({})},
	);
	t.is(result.status, 'incomplete');
	t.is(result.findings.length, 1);
	t.regex(result.incompleteReasons.join('\n'), /finder output was cut off/);
});

test('truncated NO FINDINGS is not a clean review', async t => {
	const fixture = featureFixture(t);
	const {result, report} = await review(fixture, () => ({
		content: 'NO FINDINGS',
		finishReason: 'length',
	}));
	t.is(result.status, 'incomplete');
	t.regex(result.incompleteReasons.join('\n'), /model output limit/);
	t.false(report.includes('No verified issues found'));
});

test('a truncated verifier verdict cannot confirm a finding', async t => {
	const fixture = featureFixture(t);
	const {result} = await review(fixture, call =>
		call.role === 'finder'
			? {content: divideFinding}
			: {content: verdictBlock({}), finishReason: 'length'},
	);
	t.is(result.status, 'incomplete');
	t.is(result.findings.length, 0);
	t.is(result.unverified.length, 1);
	t.regex(result.unverified[0]!.reason, /output was cut off/);
});

test('a confirmed, cited finding is reported with its verification', async t => {
	const fixture = featureFixture(t);
	const {result, calls, report} = await review(fixture, call =>
		call.role === 'finder' ? {content: divideFinding} : {content: verdictBlock({})},
	);

	t.is(result.status, 'completed');
	t.is(result.findings.length, 1);
	t.like(result.findings[0], {file: 'src/file.ts', line: 3, severity: 'high', confidence: 90});
	t.deepEqual(result.incompleteReasons, []);
	t.is(result.stats.verifierRuns, 1);
	t.is(result.stats.modelCalls, 2);
	t.regex(result.scope ?? '', /branch "feature\/grounded" against "main"/);
	t.true(report.includes('1 verified issue found.'));
	t.true(report.includes('`src/file.ts:3`'));

	const finderPrompt = calls[0]!.messages[1]!.content;
	t.true(finderPrompt.includes('+\treturn total / count;'));
	t.true(finderPrompt.includes('M src/file.ts (changed head lines: 2-4)'));
	const verifierPrompt = calls[1]!.messages[1]!.content;
	t.true(verifierPrompt.includes('ID: F1'));
	t.true(verifierPrompt.includes('>3: \treturn total / count;'));

	t.is(result.activity.status, 'completed');
	const names = result.activity.events.map(event => event.name);
	t.true(names.includes('Resolve review scope'));
	t.true(names.includes('Grounded review'));
	t.true(names.includes('finder'));
	t.true(names.includes('verifier F1'));
	t.deepEqual(
		fixture.runGit(['for-each-ref', '--format=%(refname)', 'refs/nanocoder/review/']),
		'',
	);
});

test('a clean review requires the NO FINDINGS sentinel and runs no verifier', async t => {
	const fixture = featureFixture(t);
	const {result, calls, report} = await review(fixture, () => ({content: 'NO FINDINGS'}));
	t.is(result.status, 'completed');
	t.is(calls.length, 1);
	t.true(report.includes('No verified issues found in the reviewed scope.'));
});

test('removing only a null guard retains the finding and runs the verifier', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.write('src/file.ts', 'export function name(user) {\n\tif (!user) return null;\n\treturn user.name;\n}\n');
	fixture.runGit(['add', '--all']);
	fixture.runGit(['commit', '-m', 'add guarded function']);
	fixture.runGit(['push', 'origin', 'main']);
	fixture.runGit(['checkout', '-b', 'feature/grounded']);
	fixture.write('src/file.ts', 'export function name(user) {\n\treturn user.name;\n}\n');
	fixture.runGit(['add', '--all']);
	fixture.runGit(['commit', '-m', 'remove null guard']);
	const {result, calls} = await review(fixture, call =>
		call.role === 'finder'
			? {content: findingBlock({file: 'src/file.ts', line: 2, issue: 'Null dereference', evidence: 'return user.name;'})}
			: {content: verdictBlock({reason: 'The null guard was removed and user may be null'})},
	);
	t.is(result.status, 'completed');
	t.is(result.stats.verifierRuns, 1);
	t.is(calls.filter(call => call.role === 'verifier').length, 1);
	t.is(result.findings.length, 1);
	t.deepEqual(result.dropped, []);
});

test('bad citations, rejections, and low-confidence confirmations are dropped', async t => {
	const fixture = featureFixture(t);
	const finderOutput = [
		findingBlock({file: 'src/file.ts', line: 3, severity: 'critical', issue: 'Rejected claim'}),
		findingBlock({file: 'src/file.ts', line: 2, severity: 'low', issue: 'Weak claim'}),
		findingBlock({file: 'src/file.ts', line: 90, issue: 'Past the end'}),
		findingBlock({file: 'src/unchanged.ts', line: 1, issue: 'Not in scope'}),
		'FINDING\nISSUE: no citation\nEND',
	].join('\n');
	const {result, calls} = await review(fixture, call => {
		if (call.role === 'finder') return {content: finderOutput};
		const prompt = call.messages[1]!.content;
		return prompt.includes('Rejected claim')
			? {content: verdictBlock({id: 'F1', verdict: 'REJECT', reason: 'callers guard count'})}
			: {content: verdictBlock({id: 'F2', confidence: 60})};
	});

	t.is(result.status, 'completed');
	t.deepEqual(result.findings, []);
	t.deepEqual(
		result.dropped.map(entry => entry.reason).sort(),
		['citation', 'citation', 'low-confidence', 'malformed', 'rejected'],
	);
	t.is(calls.filter(call => call.role === 'verifier').length, 2);
	t.regex(calls[1]!.messages[1]!.content, /Rejected claim/);
});

test('a finder that hits its budget makes the review incomplete, never clean', async t => {
	const fixture = featureFixture(t);
	const {result, report} = await review(
		fixture,
		call =>
			Object.keys(call.tools).length === 0
				? {content: 'NO FINDINGS'}
				: {toolCalls: [{name: 'review_read_file', args: {path: 'src/file.ts'}}]},
		{
			budgets: {
				...DEFAULT_GROUNDED_REVIEW_BUDGETS,
				finder: {maxTurns: 10, maxToolCalls: 1},
			},
		},
	);
	t.is(result.status, 'incomplete');
	t.regex(result.incompleteReasons[0] ?? '', /finder reached its budget \(1 tool calls/);
	t.false(report.includes('No verified issues found'));
	t.true(report.includes('**Review incomplete.**'));
	t.is(result.activity.status, 'completed');
});

test('unreadable finder output makes the review incomplete', async t => {
	const fixture = featureFixture(t);
	const {result} = await review(fixture, () => ({content: 'Looks great to me!'}));
	t.is(result.status, 'incomplete');
	t.regex(result.incompleteReasons[0] ?? '', /did not report in the required format/);
});

test('files too large for the prompt must be inspected before the review is complete', async t => {
	const large = Array.from({length: 1600}, (_, index) => `export const v${index} = ${index};`).join('\n');
	const fixture = featureFixture(t, {'src/large.ts': `${large}\n`});

	const skipped = await review(fixture, () => ({content: 'NO FINDINGS'}));
	t.is(skipped.result.status, 'incomplete');
	t.regex(skipped.result.incompleteReasons[0] ?? '', /never inspected: src\/large.ts/);
	t.regex(skipped.calls[0]!.messages[1]!.content, /NOT included in the diff below[\s\S]*- src\/large.ts/);

	const inspected = await review(fixture, (_call, index) =>
		index === 0
			? {toolCalls: [{name: 'review_diff', args: {path: 'src/large.ts'}}]}
			: {content: 'NO FINDINGS'},
	);
	t.is(inspected.result.status, 'incomplete');
	t.regex(inspected.result.incompleteReasons.join('\n'), /src\/large.ts was only partially inspected/);
});

test('a one-line read does not cover a file omitted from the initial prompt', async t => {
	const large = `${Array.from({length: 1600}, (_, index) => `const v${index} = ${index};`).join('\n')}\n`;
	const fixture = featureFixture(t, {'src/large.ts': large});
	for (const line of [1, 1600]) {
		const {result} = await review(fixture, (_call, index) =>
			index === 0
				? {toolCalls: [{name: 'review_read_file', args: {path: 'src/large.ts', start_line: line, end_line: line}}]}
				: {content: 'NO FINDINGS'},
		);
		t.is(result.status, 'incomplete');
		t.regex(result.incompleteReasons.join('\n'), /only partially inspected/);
	}
});

test('agent-side character clipping does not cover an otherwise untruncated diff', async t => {
	const large = `${Array.from({length: 400}, (_, index) => `const v${index} = '${'x'.repeat(200)}';`).join('\n')}\n`;
	const fixture = featureFixture(t, {'src/large.ts': large});
	const {result, calls} = await review(fixture, (_call, index) =>
		index === 0
			? {toolCalls: [{name: 'review_diff', args: {path: 'src/large.ts'}}]}
			: {content: 'NO FINDINGS'},
	);
	const output = calls[1]!.messages.at(-1)!.content;
	t.true(output.includes('[output truncated]'));
	t.false(output.includes('[diff truncated'));
	t.is(result.status, 'incomplete');
	t.regex(result.incompleteReasons.join('\n'), /only partially inspected/);
});

test('a complete tool diff or whole-file read can cover an omitted file', async t => {
	const large = `${Array.from({length: 200}, (_, index) => `const v${index} = '${'x'.repeat(25)}';`).join('\n')}\n`;
	const fixture = featureFixture(t, {'src/large.ts': large});
	for (const name of ['review_diff', 'review_read_file']) {
		const {client, calls} = createScriptedReviewClient(
			(_call, index) =>
				index === 0
					? {toolCalls: [{name, args: {path: 'src/large.ts'}}]}
					: {content: 'NO FINDINGS'},
			{contextSize: 2000},
		);
		const {result} = await review(fixture, () => ({}), {client});
		t.regex(calls[0]!.messages[1]!.content, /NOT included in the diff below[\s\S]*- src\/large.ts/);
		t.is(result.status, 'completed');
	}
});

test('findings the verifier could not judge, or beyond the verification cap, are unverified', async t => {
	const fixture = featureFixture(t);
	const finderOutput = [
		findingBlock({file: 'src/file.ts', line: 3, issue: 'First'}),
		findingBlock({file: 'src/file.ts', line: 2, issue: 'Second'}),
	].join('\n');
	const {result, calls, report} = await review(
		fixture,
		call => (call.role === 'finder' ? {content: finderOutput} : {content: 'I am not sure.'}),
		{budgets: {...DEFAULT_GROUNDED_REVIEW_BUDGETS, maxVerifications: 1}},
	);
	t.is(result.status, 'incomplete');
	t.is(calls.filter(call => call.role === 'verifier').length, 1);
	t.deepEqual(
		result.unverified.map(entry => entry.reason),
		[
			'verifier response could not be parsed',
			'not verified: only 1 findings are verified per review',
		],
	);
	t.true(report.includes('2 cited findings were not verified.'));
});

test('cancelling during the finder returns a cancelled review', async t => {
	const fixture = featureFixture(t);
	const controller = new AbortController();
	const {result, report} = await review(
		fixture,
		() => {
			controller.abort();
			const error = new Error('aborted');
			error.name = 'AbortError';
			throw error;
		},
		{signal: controller.signal},
	);
	t.is(result.status, 'cancelled');
	t.is(result.activity.status, 'cancelled');
	t.true(report.includes('**Review cancelled.**'));
});

test('cancelling during verification keeps partial results and marks the rest unverified', async t => {
	const fixture = featureFixture(t);
	const controller = new AbortController();
	const {result} = await review(
		fixture,
		call => {
			if (call.role === 'finder') return {content: divideFinding};
			controller.abort();
			throw new Error('Operation was cancelled');
		},
		{signal: controller.signal},
	);
	t.is(result.status, 'cancelled');
	t.deepEqual(result.unverified.map(entry => entry.reason), ['not verified: review cancelled']);
});

test('a failing model fails the review', async t => {
	const fixture = featureFixture(t);
	const {result, report} = await review(fixture, () => {
		throw new Error('connection refused');
	});
	t.is(result.status, 'failed');
	t.is(result.activity.status, 'failed');
	t.true(report.includes('The finder failed: connection refused'));
});

test('ambiguous requests ask for a target and empty scopes are reported without a model call', async t => {
	const fixture = featureFixture(t);
	const ambiguous = await review(fixture, () => ({content: 'NO FINDINGS'}), {
		request: 'please look at the thing I did',
	});
	t.is(ambiguous.result.status, 'clarification');
	t.is(ambiguous.calls.length, 0);
	t.true((ambiguous.result.choices ?? []).length > 0);

	const empty = await review(fixture, () => ({content: 'NO FINDINGS'}), {
		request: 'working tree',
	});
	t.is(empty.result.status, 'empty');
	t.is(empty.calls.length, 0);
	t.true(empty.report.includes('Nothing to review.'));
	t.false(empty.report.includes('No verified issues found'));
});

test('saved traces of completed, failed, and cancelled reviews keep identity and status but no prompts, diffs, or file content', async t => {
	const fixture = featureFixture(t);
	const controller = new AbortController();
	const runs = [
		await review(fixture, call =>
			call.role === 'finder'
				? {content: divideFinding}
				: {content: verdictBlock({})},
		),
	];
	runs.push(
		await review(fixture, () => {
			throw new Error('connection refused');
		}),
	);
	runs.push(
		await review(
			fixture,
			(_call, index) => {
				if (index === 0) {
					return {toolCalls: [{name: 'review_read_file', args: {path: 'src/file.ts'}}]};
				}
				controller.abort();
				throw new Error('Operation was cancelled');
			},
			{signal: controller.signal},
		),
	);

	t.deepEqual(
		runs.map(run => run.result.status),
		['completed', 'failed', 'cancelled'],
	);
	for (const {result, report} of runs) {
		const saved = JSON.parse(
			JSON.stringify(
				createReviewMessage({
					report,
					tier: 'Grounded',
					status: result.status,
					activity: result.activity,
				}),
			),
		) as Message;
		const persisted = readPersistedReview(saved);
		t.is(persisted?.status, result.status);
		t.is(persisted?.activity.reviewId, result.reviewId);
		t.is(persisted?.activity.status, result.activity.status);
		t.true((persisted?.activity.events.length ?? 0) > 0);
		const trace = JSON.stringify(persisted?.activity);
		t.false(trace.includes('meticulous code reviewer'));
		t.false(trace.includes('total / count'));
		t.false(trace.includes('export function average'));
	}
});
