/**
 * format-ci-report.ts Tests
 */

import test from 'ava';
import {formatCiReport} from './format-ci-report';

const baseInput = {
	runId: 42,
	workflowName: 'CI',
	branch: 'feature-x',
	url: 'https://github.com/o/r/actions/runs/42',
};

test('formatCiReport includes the run id, workflow, and branch', t => {
	const body = formatCiReport({
		...baseInput,
		subagentOutput: '### Summary\nBuild failed.',
	});
	t.true(body.includes('#42'));
	t.true(body.includes('CI'));
	t.true(body.includes('feature-x'));
});

test('formatCiReport includes the run URL deterministically', t => {
	const body = formatCiReport({
		...baseInput,
		subagentOutput: 'No mention of any URL here.',
	});
	t.true(body.includes(baseInput.url));
});

test('formatCiReport passes the subagent output through verbatim', t => {
	const body = formatCiReport({
		...baseInput,
		subagentOutput: '### Root Cause\nSpecific unique marker text here.',
	});
	t.true(body.includes('Specific unique marker text here.'));
});

test('formatCiReport notes the diagnosis is advisory with no auto-fix', t => {
	const body = formatCiReport({
		...baseInput,
		subagentOutput: 'Looks like a flaky test.',
	});
	t.true(body.includes('no auto-fix applied'));
});
