import test from 'ava';
import {lintCommandBody, lintToolBody} from './lint-body';

console.log(`\nlint-body.spec.ts`);

// --- tool bodies ---

test('tool: clean body with var + positive + inverted section passes', t => {
	const body = `{{# json }}gh pr view {{ pr_number }} --json x{{/ json }}{{^ json }}gh pr view {{ pr_number }}{{/ json }}`;
	const issues = lintToolBody(body, ['pr_number', 'json']);
	t.deepEqual(issues, []);
});

test('tool: undeclared variable is an error', t => {
	const issues = lintToolBody('gh issue view {{ issue_number }}', []);
	t.is(issues.length, 1);
	t.is(issues[0]?.severity, 'error');
	t.regex(issues[0]?.message ?? '', /not a declared parameter/);
});

test('tool: undeclared section variable is an error', t => {
	const issues = lintToolBody('{{# verbose }}x{{/ verbose }}', []);
	t.true(issues.some(i => /not a declared parameter/.test(i.message)));
});

test('tool: unsupported tag sigil is an error', t => {
	const issues = lintToolBody('{{> partial }}', []);
	t.is(issues.length, 1);
	t.regex(issues[0]?.message ?? '', /Unsupported tag/);
});

test('tool: triple-brace unescaped output is an error', t => {
	const issues = lintToolBody('echo {{{ name }}}', ['name']);
	t.true(issues.some(i => /Unescaped-output/.test(i.message)));
});

test('tool: unclosed section is an error', t => {
	const issues = lintToolBody('{{# a }}hello', ['a']);
	t.true(issues.some(i => /Unclosed section/.test(i.message)));
});

test('tool: mismatched closing tag is an error', t => {
	const issues = lintToolBody('{{# a }}x{{/ b }}', ['a', 'b']);
	t.true(issues.some(i => /Unbalanced closing tag/.test(i.message)));
});

// --- command bodies ---

test('command: declared param and built-ins pass', t => {
	const body = 'Review PR {{ pr }} in {{ cwd }} via {{ command }}.';
	const issues = lintCommandBody(body, ['pr']);
	t.deepEqual(issues, []);
});

test('command: undeclared placeholder is an error', t => {
	const issues = lintCommandBody('Review PR #{{ pr_number }}.', []);
	t.true(
		issues.some(
			i =>
				i.severity === 'error' &&
				/not a declared parameter or a built-in/.test(i.message),
		),
	);
});

test('command: a section over a declared parameter passes', t => {
	const issues = lintCommandBody(
		'{{# issue }}linked to #{{ issue }}{{/ issue }}',
		['issue'],
	);
	t.deepEqual(issues, []);
});

test('command: a section over an undeclared name is an error', t => {
	const issues = lintCommandBody('{{# ghost }}x{{/ ghost }}', []);
	t.true(
		issues.some(
			i => /references "ghost"/.test(i.message) && i.severity === 'error',
		),
	);
});

test('command: unclosed section is an error', t => {
	const issues = lintCommandBody('{{# issue }}hello', ['issue']);
	t.true(issues.some(i => /Unclosed section/.test(i.message)));
});

test('command: undeclared placeholders get a single how-to-fix hint', t => {
	const issues = lintCommandBody('PR {{ pr }} issue {{ iss }}', []);
	const hints = issues.filter(i => /How to fix/.test(i.message));
	t.is(hints.length, 1);
	t.regex(hints[0]?.message ?? '', /positional list of names/);
});

test('command: malformed parameters block names the exact mistake', t => {
	const issues = lintCommandBody('PR {{ pr }}', [], {parametersMalformed: true});
	t.true(
		issues.some(
			i =>
				/not a list of names/.test(i.message) &&
				/NOT the custom-tool format/.test(i.message),
		),
	);
	// The standalone "How to fix" line is suppressed when the malformed
	// message already carried the hint.
	t.false(issues.some(i => /^How to fix:/.test(i.message)));
});

test('command: non-array declaredParams does not throw', t => {
	t.notThrows(() =>
		// @ts-expect-error - exercising the defensive guard against bad input
		lintCommandBody('PR {{ pr }}', {pr: {}}),
	);
});
