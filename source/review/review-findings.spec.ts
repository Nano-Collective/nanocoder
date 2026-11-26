import test from 'ava';
import {
	formatFindingForVerifier,
	normalizeCitationPath,
	parseFindings,
	parseVerdict,
	severityRank,
} from './review-findings';

test('parses finding blocks and numbers them in order', t => {
	const parsed = parseFindings(
		[
			'I checked the callers first.',
			'FINDING',
			'FILE: src/math.ts',
			'LINE: 4',
			'SEVERITY: High',
			'ISSUE: Division by zero',
			'EVIDENCE: return total / count;',
			'END',
			'FINDING',
			'- **FILE:** `./src/other.ts:12-14`',
			'- **LINE:**',
			'- **SEVERITY:** low',
			'- **ISSUE:** Off by one',
			'- **EVIDENCE:** `i <= items.length`',
			'END',
		].join('\n'),
	);

	t.false(parsed.declaredNone);
	t.deepEqual(parsed.malformed, []);
	t.deepEqual(parsed.findings, [
		{
			id: 'F1',
			file: 'src/math.ts',
			line: 4,
			severity: 'high',
			issue: 'Division by zero',
			evidence: 'return total / count;',
		},
		{
			id: 'F2',
			file: 'src/other.ts',
			line: 12,
			severity: 'low',
			issue: 'Off by one',
			evidence: 'i <= items.length',
		},
	]);
});

test('findings without a citation, severity, or evidence are malformed, not dropped silently', t => {
	const parsed = parseFindings(
		[
			'FINDING',
			'FILE: src/math.ts',
			'SEVERITY: high',
			'ISSUE: No line given',
			'EVIDENCE: x',
			'END',
			'FINDING',
			'FILE: src/math.ts',
			'LINE: 3',
			'SEVERITY: catastrophic',
			'ISSUE: Unknown severity',
			'EVIDENCE: x',
			'END',
		].join('\n'),
	);

	t.is(parsed.findings.length, 0);
	t.is(parsed.malformed.length, 2);
	t.false(parsed.declaredNone);
});

test('the NO FINDINGS sentinel is the only way to report a clean result', t => {
	t.true(parseFindings('NO FINDINGS').declaredNone);
	t.true(parseFindings('Checked everything.\n**NO FINDINGS**').declaredNone);
	t.false(parseFindings('Looks good to me!').declaredNone);
	t.false(parseFindings('').declaredNone);
});

test('citation paths must stay inside the repository', t => {
	t.is(normalizeCitationPath('./src/a.ts'), 'src/a.ts');
	t.is(normalizeCitationPath('src\\win\\a.ts'), 'src/win/a.ts');
	t.is(normalizeCitationPath('/etc/passwd'), null);
	t.is(normalizeCitationPath('../outside.ts'), null);
	t.is(normalizeCitationPath('src//a.ts'), null);
	t.is(normalizeCitationPath('C:/repo/a.ts'), null);
	t.is(normalizeCitationPath('~/a.ts'), null);
});

test('parses a verdict and rejects mismatched IDs or out-of-range confidence', t => {
	t.deepEqual(
		parseVerdict(
			'ID: F2\nVERDICT: confirm\nCONFIDENCE: 85%\nREASON: count is unguarded',
			'F2',
		),
		{id: 'F2', verdict: 'CONFIRM', confidence: 85, reason: 'count is unguarded'},
	);
	t.is(
		parseVerdict('ID: F1\nVERDICT: CONFIRM\nCONFIDENCE: 90\nREASON: x', 'F2'),
		null,
	);
	t.is(
		parseVerdict('ID: F1\nVERDICT: CONFIRM\nCONFIDENCE: 190\nREASON: x', 'F1'),
		null,
	);
	t.is(parseVerdict('VERDICT: MAYBE\nCONFIDENCE: 50\nREASON: x', 'F1'), null);
	t.is(parseVerdict('ID: F1\nVERDICT: REJECT\nCONFIDENCE: 70', 'F1'), null);
});

test('severity ranks sort critical first and verifier input restates the claim', t => {
	t.true(severityRank('critical') < severityRank('low'));
	const text = formatFindingForVerifier({
		id: 'F1',
		file: 'src/a.ts',
		line: 3,
		severity: 'medium',
		issue: 'Leak',
		evidence: 'no close()',
	});
	t.true(text.includes('ID: F1'));
	t.true(text.includes('CLAIMED EVIDENCE: no close()'));
});

test('verdict confidence validates the entire number', t => {
	for (const confidence of ['1000', '10000', '190']) {
		t.is(
			parseVerdict(
				`ID: F1\nVERDICT: CONFIRM\nCONFIDENCE: ${confidence}\nREASON: x`,
				'F1',
			),
			null,
		);
	}
	for (const confidence of ['0', '100', '85%']) {
		t.is(
			parseVerdict(
				`ID: F1\nVERDICT: CONFIRM\nCONFIDENCE: ${confidence}\nREASON: x`,
				'F1',
			)?.confidence,
			Number.parseInt(confidence, 10),
		);
	}
});
