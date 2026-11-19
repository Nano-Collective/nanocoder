import test from 'ava';
import {ReviewActivityStore} from './review-activity';
import {renderGroundedReviewReport} from './review-report';
import type {GroundedReviewResult} from './run-grounded-review';

function result(overrides: Partial<GroundedReviewResult>): GroundedReviewResult {
	return {
		status: 'completed',
		reviewId: 'abcdef0123456789',
		scope: 'Review scope: branch feature · base aaaa · head bbbb · 1 changed file',
		findings: [],
		dropped: [],
		unverified: [],
		incompleteReasons: [],
		notes: [],
		stats: {reported: 0, verifierRuns: 0, modelCalls: 2, toolCalls: 3},
		activity: new ReviewActivityStore().toSummary(),
		...overrides,
	};
}

const finding = {
	id: 'F1',
	file: 'src/math.ts',
	line: 4,
	severity: 'high' as const,
	issue: 'Division by zero',
	evidence: 'return total / count;',
};

test('a completed clean review says no verified issues were found', t => {
	const report = renderGroundedReviewReport(result({}));
	t.true(report.startsWith('## Grounded review · completed'));
	t.true(report.includes('No verified issues found in the reviewed scope.'));
	t.true(report.endsWith('*2 model calls · 3 tool calls · 0 verifier runs · review abcdef01*'));
});

test('an incomplete review never claims to be clean and explains why', t => {
	const report = renderGroundedReviewReport(
		result({
			status: 'incomplete',
			incompleteReasons: ['The finder reached its budget.'],
			unverified: [{finding, reason: 'verifier reached its budget without a verdict'}],
		}),
	);
	t.false(report.includes('No verified issues found'));
	t.true(report.includes('**Review incomplete.**'));
	t.true(report.includes('### Why this review is incomplete\n- The finder reached its budget.'));
	t.true(report.includes('### Unverified findings'));
	t.true(report.includes('`src/math.ts:4` Division by zero'));
});

test('verified findings show severity, file:line, evidence, and the verifier reason', t => {
	const report = renderGroundedReviewReport(
		result({
			findings: [{...finding, confidence: 92, verificationReason: 'count is unguarded'}],
			dropped: [
				{reason: 'citation', detail: 'line 90 is past the end', finding: {...finding, id: 'F2', line: 90}},
				{reason: 'malformed', detail: 'missing FILE', raw: 'FINDING\nISSUE: x'},
			],
		}),
		'Deep',
	);
	t.true(report.startsWith('## Deep review · completed'));
	t.true(report.includes('1 verified issue found.'));
	t.true(report.includes('1. **HIGH** `src/math.ts:4` Division by zero'));
	t.true(report.includes('Verified (confidence 92): count is unguarded'));
	t.true(report.includes('(bad citation: line 90 is past the end)'));
	t.true(report.includes('Finder output (unreadable: missing FILE)'));
});

test('failed, cancelled, and clarification reviews are labeled as such', t => {
	t.true(
		renderGroundedReviewReport(result({status: 'failed', message: 'The finder failed: boom'})).includes(
			'**Review failed.**\n\nThe finder failed: boom',
		),
	);
	t.true(
		renderGroundedReviewReport(result({status: 'cancelled'})).includes(
			'**Review cancelled.** Results are partial.',
		),
	);
	const clarification = renderGroundedReviewReport(
		result({
			status: 'clarification',
			scope: undefined,
			message: 'Pick one',
			choices: ['Local: main', 'Remote: origin/main'],
			stats: {reported: 0, verifierRuns: 0, modelCalls: 0, toolCalls: 0},
		}),
	);
	t.true(clarification.startsWith('## Grounded review · needs a target'));
	t.true(clarification.includes('- Local: main\n- Remote: origin/main'));
	t.false(clarification.includes('model call'));
});
