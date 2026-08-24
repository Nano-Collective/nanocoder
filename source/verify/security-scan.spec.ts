/**
 * security-scan.ts Tests
 */

import test from 'ava';
import {
	formatFindingsForPrompt,
	formatFindingsSection,
	isSemgrepAvailable,
	runSecurityScan,
	type SecurityScanResult,
} from './security-scan';

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

const failed: SecurityScanResult = {
	available: true,
	ranSuccessfully: false,
	findings: [],
	errorMessage: 'boom',
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

test('formatFindingsForPrompt reports not-installed', t => {
	t.true(formatFindingsForPrompt(notInstalled).includes('not installed'));
});

test('formatFindingsForPrompt reports scan failure', t => {
	t.true(formatFindingsForPrompt(failed).includes('boom'));
});

test('formatFindingsForPrompt reports no issues', t => {
	t.true(formatFindingsForPrompt(noFindings).includes('no issues'));
});

test('formatFindingsForPrompt renders findings', t => {
	const text = formatFindingsForPrompt(withFindings);
	t.true(text.includes('ERROR'));
	t.true(text.includes('source/foo.ts:12'));
	t.true(text.includes('no-eval'));
});

test('formatFindingsSection reports not-installed with install instructions', t => {
	const text = formatFindingsSection(notInstalled);
	t.true(text.includes('not installed'));
	t.true(text.includes('pip install semgrep'));
});

test('formatFindingsSection reports "No findings."', t => {
	t.is(formatFindingsSection(noFindings), 'No findings.');
});

test('formatFindingsSection renders a bullet per finding', t => {
	const text = formatFindingsSection(withFindings);
	t.true(text.includes('- **[ERROR]**'));
	t.true(text.includes('`source/foo.ts:12`'));
});

// Gate on the environment's actual semgrep availability (mirrors
// scripts/test.sh's own `command -v semgrep` conditional) so this test is
// stable whether or not semgrep happens to be installed on the machine
// running it.
test('runSecurityScan degrades gracefully when semgrep is unavailable', async t => {
	if (isSemgrepAvailable()) {
		t.pass('semgrep is installed on this machine; degrade-path not exercised here');
		return;
	}
	const result = await runSecurityScan();
	t.false(result.available);
	t.false(result.ranSuccessfully);
	t.deepEqual(result.findings, []);
});
