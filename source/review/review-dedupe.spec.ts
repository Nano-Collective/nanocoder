import test from 'ava';
import {dedupeFindings} from './review-dedupe';
import type {ReviewFinding} from './review-findings';

function finding(
	issue: string,
	line = 3,
	file = 'src/file.ts',
): ReviewFinding {
	return {
		id: 'temp',
		file,
		line,
		severity: 'high',
		issue,
		evidence: 'return total / count;',
	};
}

test('keeps the first lens and renumbers the survivors', t => {
	const {unique, duplicates} = dedupeFindings([
		{finding: finding('Division by zero when count is 0'), lens: 'bugs'},
		{finding: finding('  DIVISION BY ZERO, when count is 0!  '), lens: 'standards and API misuse'},
		{
			finding: finding('Unused parameter total', 2),
			lens: 'intent and spec',
		},
	]);

	t.deepEqual(
		unique.map(entry => [entry.finding.id, entry.lens, entry.finding.issue]),
		[
			['F1', 'bugs', 'Division by zero when count is 0'],
			['F2', 'intent and spec', 'Unused parameter total'],
		],
	);
	t.deepEqual(duplicates, [
		{
			kept: 'bugs',
			dropped: 'standards and API misuse',
			finding: finding('  DIVISION BY ZERO, when count is 0!  '),
		},
	]);
});

test('does not merge different lines or unrelated issues', t => {
	const {unique, duplicates} = dedupeFindings([
		{finding: finding('Division by zero', 3), lens: 'bugs'},
		{finding: finding('Division by zero', 8), lens: 'bugs'},
		{finding: finding('Missing close()', 3), lens: 'standards and API misuse'},
	]);
	t.is(unique.length, 3);
	t.deepEqual(duplicates, []);
});

for (const longer of [
	'Missing validation for idempotencyKey',
	'Missing validation for id and auth token',
]) {
	for (const reverse of [false, true]) {
		test(`preserves distinct issues: ${longer} (${reverse ? 'longer first' : 'shorter first'})`, t => {
			const issues = ['Missing validation for id', longer];
			if (reverse) issues.reverse();
			const {unique, duplicates} = dedupeFindings(
				issues.map((issue, index) => ({finding: finding(issue), lens: `lens ${index}`})),
			);
			t.deepEqual(unique.map(entry => entry.finding.issue), issues);
			t.deepEqual(duplicates, []);
		});
	}
}
