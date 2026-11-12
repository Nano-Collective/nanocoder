import test from 'ava';
import {buildEditRecovery, EditRecoveryError} from './edit-recovery';

test('recovery returns original tabs and coordinates without changing input', t => {
	const content = 'header\n\tif (ready) {\n\t\tstart();\n\t}\nfooter';
	const result = buildEditRecovery('a.ts', content, '  if (ready) {\n    start();\n  }');
	t.is(result.status, 'candidate_found');
	t.is(result.candidates[0].actualText, '\tif (ready) {\n\t\tstart();\n\t}');
	t.is(result.candidates[0].startLine, 2);
	t.is(result.candidates[0].endLine, 4);
});

test('recovery preserves missing blank lines and trailing whitespace', t => {
	const actual = 'function run() {\n\n\tstart();  \n}';
	const result = buildEditRecovery('a.ts', actual, 'function run() {\nstart();\n}');
	t.is(result.candidates[0].actualText, actual);
	t.is(result.candidates[0].matchKind, 'blank_lines');
	t.regex(result.candidates[0].differences[0], /1 more blank/);
});

test('recovery locates a block when search has an extra blank line', t => {
	const actual = 'function run() {\nstart();\n}';
	const result = buildEditRecovery('a.ts', actual, 'function run() {\n\nstart();\n}');
	t.is(result.candidates[0].actualText, actual);
	t.regex(result.candidates[0].differences[0], /1 fewer blank/);
});

test('recovery preserves CRLF exactly', t => {
	const result = buildEditRecovery('a.ts', 'const first = 1;\r\nconst second = 2;', 'const first = 1;\nconst second = 2;');
	t.is(result.candidates[0].matchKind, 'line_endings');
	t.is(result.candidates[0].actualText, 'const first = 1;\r\nconst second = 2;');
});

test('fuzzy recovery requires matching anchors and reports changed code', t => {
	const actual = 'function calculate() {\nconst value = source + 2;\nreturn value;\n}';
	const result = buildEditRecovery('a.ts', actual, 'function calculate() {\nconst value = source + 1;\nreturn value;\n}');
	t.is(result.status, 'candidate_found');
	t.is(result.candidates[0].matchKind, 'fuzzy');
	t.is(result.candidates[0].actualText, actual);
	t.regex(result.candidates[0].differences[0], /Non-whitespace/);
});

test('recovery does not arbitrarily pick repeated targets', t => {
	const block = '\tconst first = 1;\n\tconst second = 2;';
	const result = buildEditRecovery('a.ts', `${block}\n\n${block}`, block.replaceAll('\t', '  '));
	t.is(result.status, 'ambiguous');
	t.is(result.candidates.length, 2);
	t.deepEqual(result.candidates.map(c => c.startLine), [1, 4]);
});

test('unrelated, short and case-mismatched searches do not invent candidates', t => {
	for (const search of ['}', 'const other = unrelated;', 'FUNCTION CALCULATE() {']) {
		t.is(buildEditRecovery('a.ts', 'function calculate() {\nreturn result;\n}', search).status, 'no_candidate');
	}
});

test('recovery caps large inputs and omits oversized candidate bodies', t => {
	t.is(buildEditRecovery('a.ts', 'x'.repeat(1_000_001), 'const first = 1;').status, 'budget_exceeded');
	t.is(buildEditRecovery('a.ts', 'const first = 1;', 'x'.repeat(8001)).status, 'budget_exceeded');
	const actual = 'const first = 1;\n' + '\n'.repeat(80) + 'const second = 2;';
	const result = buildEditRecovery('a.ts', actual, 'const first = 1;\nconst second = 2;');
	t.true(result.candidates[0].truncated);
	t.is(result.candidates[0].actualText, undefined);
	t.regex(result.nextAction, /Read/);
});

test('serialized payload is bounded even when JSON escaping expands text', t => {
	const actual = '\t'.repeat(2000) + 'const first = 1;';
	const result = buildEditRecovery('a.ts', actual, ' const first = 1;');
	t.true(JSON.stringify(result).length <= 4000);
	t.true(result.candidates[0].truncated);
	t.is(result.candidates[0].actualText, undefined);
});

test('error carries structured evidence with literal whitespace escaped as JSON', t => {
	const error = new EditRecoveryError('Content not found', 'a.ts', '\tconst first = 1;', '  const first = 1;', 2);
	t.is(error.recovery.blockNumber, 2);
	t.regex(error.message, /No changes were written/);
	t.deepEqual(JSON.parse(error.message.split('JSON):\n')[1]), error.recovery);
});

test('recovery preserves boundary blank lines in a suggested search', t => {
	const actual = '\n\tconst first = 1;\n\tconst second = 2;\n';
	const result = buildEditRecovery('a.ts', actual, '\n  const first = 1;\n  const second = 2;\n');
	t.is(result.candidates[0].actualText, actual);
	t.is(result.candidates[0].startLine, 1);
	t.is(result.candidates[0].endLine, 4);
});

test('comparison limit returns an explicit fallback rather than an incomplete selection', t => {
	const content = 'sharedValue;\n'.repeat(25_001);
	const result = buildEditRecovery('a.ts', content, Array(5).fill('  sharedValue;').join('\n'));
	t.is(result.status, 'budget_exceeded');
	t.deepEqual(result.candidates, []);
});
