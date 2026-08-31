/**
 * security-scan.ts Tests
 */

import {EventEmitter} from 'node:events';
import test from 'ava';
import {
	formatFindingsForPrompt,
	formatFindingsSection,
	isSemgrepAvailable,
	parseFindings,
	resolveScanPaths,
	runSecurityScan,
	runSemgrepProcess,
	type SecurityScanResult,
} from './security-scan';

const noFindings: SecurityScanResult = {
	available: true,
	ranSuccessfully: true,
	findings: [],
	totalFound: 0,
};

const notInstalled: SecurityScanResult = {
	available: false,
	ranSuccessfully: false,
	findings: [],
	totalFound: 0,
};

const failed: SecurityScanResult = {
	available: true,
	ranSuccessfully: false,
	findings: [],
	totalFound: 0,
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
	totalFound: 1,
};

const capped: SecurityScanResult = {
	available: true,
	ranSuccessfully: true,
	findings: [withFindings.findings[0]],
	totalFound: 137,
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

test('formatFindingsForPrompt discloses the cap when totalFound exceeds shown findings', t => {
	const text = formatFindingsForPrompt(capped);
	t.true(text.includes('showing 1 of 137'));
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

test('formatFindingsSection discloses the cap when totalFound exceeds shown findings', t => {
	const text = formatFindingsSection(capped);
	t.true(text.includes('Showing 1 of 137'));
});

// ============================================================================
// parseFindings — severity normalization, sort order, the MAX_FINDINGS cap
// ============================================================================

function semgrepJson(
	results: Array<{
		check_id?: string;
		path?: string;
		start?: {line?: number};
		end?: {line?: number};
		extra?: {severity?: string; message?: string};
	}>,
): string {
	return JSON.stringify({results});
}

test('parseFindings normalizes an unrecognized severity to INFO', t => {
	const {findings} = parseFindings(
		semgrepJson([{check_id: 'r1', extra: {severity: 'WEIRD'}}]),
	);
	t.is(findings[0].severity, 'INFO');
});

test('parseFindings sorts ERROR before WARNING before INFO', t => {
	const {findings} = parseFindings(
		semgrepJson([
			{check_id: 'i', extra: {severity: 'INFO'}},
			{check_id: 'e', extra: {severity: 'ERROR'}},
			{check_id: 'w', extra: {severity: 'WARNING'}},
		]),
	);
	t.deepEqual(
		findings.map(f => f.ruleId),
		['e', 'w', 'i'],
	);
});

test('parseFindings caps findings at 50 but reports the true totalFound', t => {
	const results = Array.from({length: 75}, (_, i) => ({
		check_id: `rule-${i}`,
		extra: {severity: 'ERROR' as const},
	}));
	const {findings, totalFound} = parseFindings(semgrepJson(results));
	t.is(findings.length, 50);
	t.is(totalFound, 75);
});

test('parseFindings defaults missing fields sensibly', t => {
	const {findings, totalFound} = parseFindings(semgrepJson([{}]));
	t.is(totalFound, 1);
	t.is(findings[0].ruleId, 'unknown-rule');
	t.is(findings[0].path, 'unknown-file');
	t.is(findings[0].startLine, 0);
	t.is(findings[0].message, '');
});

// ============================================================================
// resolveScanPaths — empty/unset input and the too-many-paths fallback
// ============================================================================

test('resolveScanPaths scans the whole tree when no paths are given', t => {
	t.deepEqual(resolveScanPaths(), ['.']);
	t.deepEqual(resolveScanPaths([]), ['.']);
});

test('resolveScanPaths passes through a reasonably-sized path list', t => {
	t.deepEqual(resolveScanPaths(['a.ts', 'b.ts']), ['a.ts', 'b.ts']);
});

test('resolveScanPaths falls back to the whole tree past MAX_SCAN_PATHS', t => {
	const manyPaths = Array.from({length: 301}, (_, i) => `file-${i}.ts`);
	t.deepEqual(resolveScanPaths(manyPaths), ['.']);
});

test('resolveScanPaths does not fall back exactly at the threshold', t => {
	const paths = Array.from({length: 300}, (_, i) => `file-${i}.ts`);
	t.deepEqual(resolveScanPaths(paths), paths);
});

// ============================================================================
// runSemgrepProcess — timeout / empty-stdout / spawn-error, via an injected
// fake spawn function so these don't depend on semgrep actually being
// installed.
// ============================================================================

// biome-ignore lint/suspicious/noExplicitAny: matching node's loosely-typed ChildProcess shape for a test double
function createFakeProc(): any {
	const proc: any = new EventEmitter();
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.kill = () => {};
	return proc;
}

test('runSemgrepProcess rejects when the process times out', async t => {
	const proc = createFakeProc();
	const killed: string[] = [];
	// Simulate the OS actually killing the process shortly after SIGTERM,
	// which is what drives the real ChildProcess's 'close' event.
	proc.kill = (signal?: string) => {
		killed.push(signal ?? '');
		setImmediate(() => proc.emit('close', null));
	};

	// The production timer is deliberately `.unref()`'d (so a hung scan never
	// keeps the whole `verify` process alive). In this test it'd otherwise be
	// the only pending handle, and Node can let the event loop go idle before
	// an unref'd timer fires — keep something ref'd for the duration.
	const keepAlive = setInterval(() => {}, 1_000);
	try {
		const spawnFn = () => proc;
		const promise = runSemgrepProcess('.', 20, ['.'], spawnFn);
		await t.throwsAsync(promise, {message: /timed out after 20ms/});
		t.true(killed.includes('SIGTERM'));
	} finally {
		clearInterval(keepAlive);
	}
});

test('runSemgrepProcess rejects on empty stdout with no stderr', async t => {
	const proc = createFakeProc();
	const spawnFn = () => proc;
	const promise = runSemgrepProcess('.', 0, ['.'], spawnFn);
	proc.emit('close', 0);
	await t.throwsAsync(promise, {message: /produced no output/});
});

test('runSemgrepProcess rejects when stdout is empty but stderr has content', async t => {
	const proc = createFakeProc();
	const spawnFn = () => proc;
	const promise = runSemgrepProcess('.', 0, ['.'], spawnFn);
	proc.stderr.emit('data', Buffer.from('permission denied'));
	proc.emit('close', 1);
	await t.throwsAsync(promise, {message: /permission denied/});
});

test('runSemgrepProcess resolves with stdout even on non-zero exit, if stdout is present', async t => {
	const proc = createFakeProc();
	const spawnFn = () => proc;
	const promise = runSemgrepProcess('.', 0, ['.'], spawnFn);
	proc.stdout.emit('data', Buffer.from('{"results":[]}'));
	proc.emit('close', 1);
	t.is(await promise, '{"results":[]}');
});

test('runSemgrepProcess rejects when spawning fails', async t => {
	const proc = createFakeProc();
	const spawnFn = () => proc;
	const promise = runSemgrepProcess('.', 0, ['.'], spawnFn);
	proc.emit('error', new Error('ENOENT'));
	await t.throwsAsync(promise, {message: /Failed to execute semgrep/});
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
	t.is(result.totalFound, 0);
});
