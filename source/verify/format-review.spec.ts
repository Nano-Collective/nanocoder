/**
 * format-review.ts Tests
 */

import test from 'ava';
import {formatReviewBody} from './format-review';
import type {SecurityScanResult} from './security-scan';

const noFindings: SecurityScanResult = {
	available: true,
	ranSuccessfully: true,
	findings: [],
};

const notInstalled: SecurityScanResult = {
	available: false,
	ranSuccessfully: false,
	findings: [],
};

const withFindings: SecurityScanResult = {
	available: true,
	ranSuccessfully: true,
	findings: [
		{
			ruleId: 'no-eval',
			path: 'source/foo.ts',
			startLine: 12,
			endLine: 12,
			severity: 'ERROR',
			message: 'Avoid eval().',
		},
	],
};

test('formatReviewBody includes the PR header with the correct number', t => {
	const body = formatReviewBody({
		prNumber: 861,
		subagentOutput: '### Summary\nLooks fine.',
		scan: noFindings,
	});
	t.true(body.includes('## Nanocoder Automated Review — PR #861'));
});

test('formatReviewBody passes the subagent output through verbatim', t => {
	const body = formatReviewBody({
		prNumber: 1,
		subagentOutput: '### Summary\nSpecific unique marker text here.',
		scan: noFindings,
	});
	t.true(body.includes('Specific unique marker text here.'));
});

test('formatReviewBody reflects semgrep findings deterministically regardless of subagent text', t => {
	const body = formatReviewBody({
		prNumber: 1,
		subagentOutput: 'The subagent never mentioned any findings.',
		scan: withFindings,
	});
	t.true(body.includes('no-eval'));
	t.true(body.includes('source/foo.ts:12'));
	t.true(body.includes('Avoid eval()'));
});

test('formatReviewBody shows "No findings." when semgrep found nothing', t => {
	const body = formatReviewBody({
		prNumber: 1,
		subagentOutput: 'Looks good.',
		scan: noFindings,
	});
	t.true(body.includes('No findings.'));
});

test('formatReviewBody notes when semgrep is not installed', t => {
	const body = formatReviewBody({
		prNumber: 1,
		subagentOutput: 'Looks good.',
		scan: notInstalled,
	});
	t.true(body.includes('semgrep is not installed'));
});

test('formatReviewBody notes the review is a non-blocking comment', t => {
	const body = formatReviewBody({
		prNumber: 1,
		subagentOutput: 'Looks good.',
		scan: noFindings,
	});
	t.true(body.includes('does not block merge'));
});
