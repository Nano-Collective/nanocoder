import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {changedLinesFromDiff, validateCitations} from './citation-validate.js';
import {
	applyVerdicts,
	formatFinding,
	normaliseCitationPath,
	parseFindings,
	parseVerdicts,
	type ReviewFinding,
} from './finding-format.js';

console.log('\nreview contract specs');

// ============================================================================
// Finding parsing

const makeFinding = (overrides: Partial<ReviewFinding> = {}): ReviewFinding => ({
	id: 'F1',
	file: 'source/foo.ts',
	line: 42,
	severity: 'high',
	issue: 'off-by-one in loop bound',
	evidence: 'for (let i = 0; i <= items.length; i++)',
	...overrides,
});

test('parseFindings - reads a complete FINDING block', t => {
	const output = [
		'FINDING',
		'FILE: source/foo.ts',
		'LINE: 42',
		'SEVERITY: high',
		'ISSUE: off-by-one in loop bound',
		'EVIDENCE: for (let i = 0; i <= items.length; i++)',
		'END',
	].join('\n');

	const {findings, discarded, unparseable} = parseFindings(output);
	t.is(findings.length, 1);
	t.deepEqual(discarded, []);
	t.false(unparseable);
	t.deepEqual(findings[0], makeFinding());
});

test('parseFindings - assigns stable IDs in output order', t => {
	const one = 'FINDING\nFILE: a.ts\nLINE: 1\nSEVERITY: low\nISSUE: i1\nEVIDENCE: e1\nEND';
	const two = 'FINDING\nFILE: b.ts\nLINE: 2\nSEVERITY: low\nISSUE: i2\nEVIDENCE: e2\nEND';
	const {findings} = parseFindings(`${one}\n${two}`);
	t.deepEqual(
		findings.map(f => f.id),
		['F1', 'F2'],
	);
});

test('parseFindings - tolerates markdown decoration and surrounding prose', t => {
	const output = [
		'Here are my findings:',
		'',
		'- **FINDING**',
		'- FILE: `source/foo.ts`',
		'- LINE: 42',
		'- SEVERITY: **high**',
		'- ISSUE: something broke',
		'- EVIDENCE: `x === 1`',
		'- END',
		'',
		'That is all.',
	].join('\n');

	const {findings, discarded} = parseFindings(output);
	t.is(findings.length, 1);
	t.is(findings[0].file, 'source/foo.ts');
	t.is(findings[0].severity, 'high');
	t.deepEqual(discarded, []);
});

test('parseFindings - parses markerless blocks starting at FILE', t => {
	const output = [
		'Found a problem:',
		'FILE: a.ts',
		'LINE: 3',
		'SEVERITY: medium',
		'ISSUE: unchecked null',
		'EVIDENCE: obj.field',
	].join('\n');

	const {findings} = parseFindings(output);
	t.is(findings.length, 1);
	t.is(findings[0].file, 'a.ts');
	t.is(findings[0].id, 'F1');
});

test('parseFindings - discards incomplete blocks but keeps the rest', t => {
	const good = 'FINDING\nFILE: a.ts\nLINE: 1\nSEVERITY: low\nISSUE: i\nEVIDENCE: e\nEND';
	const bad = 'FINDING\nFILE: b.ts\nLINE: 2\nSEVERITY: low\nISSUE: missing evidence\nEND';
	const {findings, discarded} = parseFindings(`${good}\n${bad}`);
	t.is(findings.length, 1);
	t.is(findings[0].file, 'a.ts');
	t.is(discarded.length, 1);
	t.true(discarded[0].includes('b.ts'));
});

test('parseFindings - rejects bad line numbers and severities', t => {
	const cases = [
		'FINDING\nFILE: a.ts\nLINE: 0\nSEVERITY: low\nISSUE: i\nEVIDENCE: e\nEND',
		'FINDING\nFILE: a.ts\nLINE: -2\nSEVERITY: low\nISSUE: i\nEVIDENCE: e\nEND',
		'FINDING\nFILE: a.ts\nLINE: abc\nSEVERITY: low\nISSUE: i\nEVIDENCE: e\nEND',
		'FINDING\nFILE: a.ts\nLINE: 4\nSEVERITY: catastrophic\nISSUE: i\nEVIDENCE: e\nEND',
	];
	for (const output of cases) {
		const {findings, discarded} = parseFindings(output);
		t.is(findings.length, 0, output);
		t.is(discarded.length, 1, output);
	}
});

test('parseFindings - rejects absolute, home, and traversal paths', t => {
	const cases = [
		'FINDING\nFILE: /etc/passwd\nLINE: 1\nSEVERITY: low\nISSUE: i\nEVIDENCE: e\nEND',
		'FINDING\nFILE: ~/secrets\nLINE: 1\nSEVERITY: low\nISSUE: i\nEVIDENCE: e\nEND',
		'FINDING\nFILE: ../outside.ts\nLINE: 1\nSEVERITY: low\nISSUE: i\nEVIDENCE: e\nEND',
	];
	for (const output of cases) {
		const {findings} = parseFindings(output);
		t.is(findings.length, 0, output);
	}
});

test('parseFindings - normalises backslashes and a leading ./', t => {
	const output = 'FINDING\nFILE: .\\source\\foo.ts\nLINE: 1\nSEVERITY: low\nISSUE: i\nEVIDENCE: e\nEND';
	const {findings} = parseFindings(output);
	t.is(findings[0].file, 'source/foo.ts');
});

test('parseFindings - empty or prose-only output is unparseable, not clean', t => {
	for (const output of ['', 'the diff looks fine to me, nice work']) {
		const parsed = parseFindings(output);
		t.is(parsed.findings.length, 0);
		t.true(parsed.unparseable);
	}
});

// ============================================================================
// Two findings on the same line: the collision case

test('parseFindings - two findings may cite the same file and line', t => {
	const one = 'FINDING\nFILE: a.ts\nLINE: 10\nSEVERITY: high\nISSUE: injection risk\nEVIDENCE: eval(input)\nEND';
	const two = 'FINDING\nFILE: a.ts\nLINE: 10\nSEVERITY: low\nISSUE: missing error handling\nEVIDENCE: try { eval(input) }\nEND';
	const {findings} = parseFindings(`${one}\n${two}`);

	t.is(findings.length, 2);
	t.not(findings[0].id, findings[1].id, 'same-line findings still get distinct IDs');
	t.is(findings[0].issue, 'injection risk');
	t.is(findings[1].issue, 'missing error handling');
});

test('applyVerdicts - same-line findings get independent verdicts', t => {
	const one = makeFinding({id: 'F1', line: 10, issue: 'injection risk'});
	const two = makeFinding({id: 'F2', line: 10, issue: 'missing error handling'});

	const {confirmed, dropped} = applyVerdicts([one, two], [
		{id: 'F1', verdict: 'CONFIRM', reason: 'reproduced'},
		{id: 'F2', verdict: 'REJECT', reason: 'guarded upstream'},
	]);

	t.is(confirmed.length, 1);
	t.is(confirmed[0].id, 'F1');
	t.is(dropped.length, 1);
	t.is(dropped[0].finding.id, 'F2');
	t.is(dropped[0].verdict, 'REJECT');
});

test('applyVerdicts - a verdict for an unknown ID affects nothing', t => {
	const finding = makeFinding({id: 'F1'});
	const {confirmed, dropped} = applyVerdicts([finding], [
		{id: 'F9', verdict: 'CONFIRM', reason: 'echoed wrong id'},
	]);
	t.is(confirmed.length, 0);
	t.is(dropped[0].verdict, 'UNVERIFIED');
	t.is(dropped[0].reason, 'no verdict');
});

test('applyVerdicts - missing verdict means UNVERIFIED, never confirmed', t => {
	const {confirmed, dropped} = applyVerdicts([makeFinding()], []);
	t.is(confirmed.length, 0);
	t.is(dropped[0].verdict, 'UNVERIFIED');
});

test('applyVerdicts - first verdict for an ID wins over later duplicates', t => {
	const finding = makeFinding({id: 'F1'});
	const {confirmed} = applyVerdicts([finding], [
		{id: 'F1', verdict: 'REJECT', reason: 'checked, not a bug'},
		{id: 'F1', verdict: 'CONFIRM', reason: 'overwrite attempt'},
	]);
	t.is(confirmed.length, 0, 'a stray second verdict must not overwrite');
});

// ============================================================================
// Verdict parsing

test('parseVerdicts - reads ID, VERDICT, and REASON', t => {
	const output = 'VERDICT: CONFIRM\nID: F1\nREASON: the bug is real';
	const {verdicts, discarded} = parseVerdicts(output);
	t.is(verdicts.length, 1);
	t.is(verdicts[0].id, 'F1');
	t.is(verdicts[0].verdict, 'CONFIRM');
	t.deepEqual(discarded, []);
});

test('parseVerdicts - reads several blank-line-separated verdicts', t => {
	const output = [
		'VERDICT: CONFIRM\nID: F1\nREASON: real',
		'',
		'VERDICT: REJECT\nID: F2\nREASON: guarded',
		'',
		'VERDICT: INSUFFICIENT\nID: F3\nREASON: cannot tell from the code',
	].join('\n');
	const {verdicts} = parseVerdicts(output);
	t.is(verdicts.length, 3);
	t.deepEqual(
		verdicts.map(v => v.verdict),
		['CONFIRM', 'REJECT', 'INSUFFICIENT'],
	);
});

test('parseVerdicts - rejects invalid verdicts and missing fields', t => {
	const {verdicts} = parseVerdicts(
		'VERDICT: MAYBE\nID: F1\nREASON: unclear\n\nVERDICT: CONFIRM\nID: F2\nREASON: ok',
	);
	t.is(verdicts.length, 1);
	t.is(verdicts[0].id, 'F2');
});

// ============================================================================
// Formatting round-trips

test('formatFinding - output reparses to the same finding', t => {
	const finding = makeFinding();
	const reparsed = parseFindings(formatFinding(finding));
	t.is(reparsed.findings.length, 1);
	// The ID field is part of the format the verifier sees.
	t.is(reparsed.findings[0].file, finding.file);
	t.is(reparsed.findings[0].line, finding.line);
	t.is(reparsed.findings[0].issue, finding.issue);
	t.true(formatFinding(finding).includes('ID: F1'));
});

test('normaliseCitationPath - accepts plain relative paths', t => {
	t.is(normaliseCitationPath('source/foo.ts'), 'source/foo.ts');
	t.is(normaliseCitationPath('./source/foo.ts'), 'source/foo.ts');
	t.is(normaliseCitationPath('source\\foo.ts'), 'source/foo.ts');
	t.is(normaliseCitationPath('  spaced.ts  '), 'spaced.ts');
	t.is(normaliseCitationPath(''), null);
	t.is(normaliseCitationPath('/abs'), null);
});

// ============================================================================
// Citation validation

test('validateCitations - accepts an existing in-range file', t => {
	const root = mkdtempSync(join(tmpdir(), 'nc-citation-'));
	writeFileSync(join(root, 'foo.ts'), 'line1\nline2\nline3\n');
	const {valid, invalid} = validateCitations(root, [{file: 'foo.ts', line: 2}]);
	t.is(valid.length, 1);
	t.is(invalid.length, 0);
});

test('validateCitations - rejects nonexistent files', t => {
	const root = mkdtempSync(join(tmpdir(), 'nc-citation-'));
	const {valid, invalid} = validateCitations(root, [
		{file: 'ghost.ts', line: 1},
	]);
	t.is(valid.length, 0);
	t.true(invalid[0].reason.includes('file not found'));
});

test('validateCitations - rejects lines past end of file', t => {
	const root = mkdtempSync(join(tmpdir(), 'nc-citation-'));
	writeFileSync(join(root, 'foo.ts'), 'one\n');
	const {invalid} = validateCitations(root, [{file: 'foo.ts', line: 5}]);
	t.true(invalid[0].reason.includes('past end of file'));
});

test('validateCitations - without diff data, no hunk requirement applies', t => {
	const root = mkdtempSync(join(tmpdir(), 'nc-citation-'));
	writeFileSync(join(root, 'foo.ts'), 'a\nb\nc\n');
	const {valid} = validateCitations(root, [{file: 'foo.ts', line: 1}]);
	t.is(valid.length, 1);
});

test('changedLinesFromDiff - extracts added and context lines per file', t => {
	const diff = [
		'diff --git a/foo.ts b/foo.ts',
		'--- a/foo.ts',
		'+++ b/foo.ts',
		'@@ -1,3 +1,4 @@',
		' context',
		'-removed',
		'+added1',
		'+added2',
		' more-context',
	].join('\n');

	const {files} = changedLinesFromDiff(diff);
	const set = files.get('foo.ts');
	t.truthy(set);
	t.true(set.has(1), 'context line 1 counts as changed vicinity');
	t.true(set.has(2), 'added line 2');
	t.true(set.has(3), 'added line 3');
	t.true(set.has(4), 'trailing context line 4');
});

test('changedLinesFromDiff - tracks several files', t => {
	const diff = [
		'diff --git a/a.ts b/a.ts',
		'--- a/a.ts',
		'+++ b/a.ts',
		'@@ -1 +1 @@',
		'+alpha',
		'diff --git a/b.ts b/b.ts',
		'--- a/b.ts',
		'+++ b/b.ts',
		'@@ -5 +5 @@',
		'+beta',
	].join('\n');

	const {files} = changedLinesFromDiff(diff);
	t.true(files.get('a.ts')?.has(1) ?? false);
	t.true(files.get('b.ts')?.has(5) ?? false);
});

test('validateCitations - with diff data, rejects lines far from any hunk', t => {
	const root = mkdtempSync(join(tmpdir(), 'nc-citation-'));
	writeFileSync(
		join(root, 'foo.ts'),
		['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10'].join('\n'),
	);
	const diff = [
		'diff --git a/foo.ts b/foo.ts',
		'--- a/foo.ts',
		'+++ b/foo.ts',
		'@@ -1,2 +1,2 @@',
		'-l1',
		'+l1 fixed',
		' l2',
	].join('\n');
	const changed = changedLinesFromDiff(diff);

	const near = validateCitations(root, [{file: 'foo.ts', line: 3}], changed);
	t.is(near.valid.length, 1, 'within three lines of the hunk');

	const far = validateCitations(root, [{file: 'foo.ts', line: 10}], changed);
	t.is(far.valid.length, 0);
	t.true(far.invalid[0].reason.includes('not in or near'));
});

test('validateCitations - with diff data, rejects files outside the diff', t => {
	const root = mkdtempSync(join(tmpdir(), 'nc-citation-'));
	writeFileSync(join(root, 'unrelated.ts'), 'x\n');
	const diff = [
		'diff --git a/other.ts b/other.ts',
		'--- a/other.ts',
		'+++ b/other.ts',
		'@@ -1 +1 @@',
		'+change',
	].join('\n');
	const changed = changedLinesFromDiff(diff);

	const {invalid} = validateCitations(
		root,
		[{file: 'unrelated.ts', line: 1}],
		changed,
	);
	t.true(invalid[0].reason.includes('not part of the reviewed changes'));
});
