/**
 * Semgrep-backed static analysis pass for `nanocoder verify`.
 *
 * Semgrep is an optional external binary (already used by this repo's own
 * CI — see `.github/workflows/pr-checks.yml`'s `semgrep-scan` job and
 * `pnpm test:security` — but never as an npm dependency). This module
 * degrades gracefully when it isn't installed, mirroring the
 * `command -v semgrep` guard in `scripts/test.sh` and the `isGhAvailable()`
 * pattern in `source/tools/git/utils.ts`.
 */

import {execSync, spawn} from 'node:child_process';
import {TIMEOUT_SEMGREP_MS} from '@/constants';

export interface SemgrepFinding {
	ruleId: string;
	path: string;
	startLine: number;
	endLine: number;
	severity: 'ERROR' | 'WARNING' | 'INFO';
	message: string;
}

export interface SecurityScanResult {
	/** Whether the `semgrep` binary was found on PATH. */
	available: boolean;
	/** Whether the scan ran and produced parseable output. */
	ranSuccessfully: boolean;
	/** Findings sorted ERROR > WARNING > INFO, capped at MAX_FINDINGS. */
	findings: SemgrepFinding[];
	/** Count of findings before the MAX_FINDINGS cap was applied. */
	totalFound: number;
	errorMessage?: string;
}

/** Matches node:child_process's `spawn` signature — injectable for tests. */
type SpawnFn = typeof spawn;

const MAX_FINDINGS = 50;

// A very large PR (bulk rename, lockfile regen) can produce a changed-file
// list long enough that spreading every path into semgrep's argv risks
// hitting the OS command-line length limit (ARG_MAX / ~32K on Windows).
// Past this count, fall back to scanning the whole tree instead of failing
// the scan outright.
const MAX_SCAN_PATHS = 300;

const SEVERITY_ORDER: Record<SemgrepFinding['severity'], number> = {
	ERROR: 0,
	WARNING: 1,
	INFO: 2,
};

/** Mirrors `isGhAvailable()` in `source/tools/git/utils.ts`. */
export function isSemgrepAvailable(): boolean {
	try {
		execSync('semgrep --version', {stdio: 'ignore'});
		return true;
	} catch {
		return false;
	}
}

interface RawSemgrepResult {
	check_id?: string;
	path?: string;
	start?: {line?: number};
	end?: {line?: number};
	extra?: {
		severity?: string;
		message?: string;
	};
}

function normalizeSeverity(
	raw: string | undefined,
): SemgrepFinding['severity'] {
	const upper = raw?.toUpperCase();
	if (upper === 'ERROR' || upper === 'WARNING' || upper === 'INFO') {
		return upper;
	}
	return 'INFO';
}

/**
 * Parse semgrep's `--json` output into sorted, capped findings. Exported for
 * direct unit testing of severity normalization, sort order, and the cap —
 * behavior that's otherwise only reachable by actually running semgrep.
 */
export function parseFindings(stdout: string): {
	findings: SemgrepFinding[];
	totalFound: number;
} {
	const parsed = JSON.parse(stdout) as {results?: RawSemgrepResult[]};
	const results = Array.isArray(parsed.results) ? parsed.results : [];

	const findings: SemgrepFinding[] = results.map(r => ({
		ruleId: r.check_id ?? 'unknown-rule',
		path: r.path ?? 'unknown-file',
		startLine: r.start?.line ?? 0,
		endLine: r.end?.line ?? r.start?.line ?? 0,
		severity: normalizeSeverity(r.extra?.severity),
		message: (r.extra?.message ?? '').trim(),
	}));

	findings.sort(
		(a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
	);
	return {
		findings: findings.slice(0, MAX_FINDINGS),
		totalFound: findings.length,
	};
}

/**
 * Resolves the effective scan target paths: an empty/unset list scans the
 * whole tree, and a list too long to safely pass as argv (see
 * MAX_SCAN_PATHS) falls back to the whole tree rather than erroring.
 * Exported for direct unit testing of the fallback threshold.
 */
export function resolveScanPaths(paths?: string[]): string[] {
	if (!paths?.length) return ['.'];
	return paths.length > MAX_SCAN_PATHS ? ['.'] : paths;
}

/**
 * Runs `semgrep scan --config auto --json` against `opts.cwd`. Never throws
 * — any failure (missing binary, spawn error, timeout, unparseable output)
 * is reported in the returned result so a flaky/missing semgrep never
 * aborts a `verify` run.
 *
 * Pass `paths` to scope the scan to specific files/dirs (e.g. a PR's changed
 * files) instead of the whole tree — keeps scan time down and avoids
 * pre-existing repo-wide findings crowding out what the PR introduced.
 */
export async function runSecurityScan(opts?: {
	cwd?: string;
	timeoutMs?: number;
	paths?: string[];
	spawnFn?: SpawnFn;
}): Promise<SecurityScanResult> {
	if (!isSemgrepAvailable()) {
		return {
			available: false,
			ranSuccessfully: false,
			findings: [],
			totalFound: 0,
		};
	}

	const cwd = opts?.cwd ?? process.cwd();
	const timeoutMs = opts?.timeoutMs ?? TIMEOUT_SEMGREP_MS;
	const paths = resolveScanPaths(opts?.paths);

	try {
		const stdout = await runSemgrepProcess(
			cwd,
			timeoutMs,
			paths,
			opts?.spawnFn,
		);
		const {findings, totalFound} = parseFindings(stdout);
		return {available: true, ranSuccessfully: true, findings, totalFound};
	} catch (error) {
		return {
			available: true,
			ranSuccessfully: false,
			findings: [],
			totalFound: 0,
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Spawns semgrep and collects its stdout. `spawnFn` defaults to node's real
 * `spawn` but is injectable so tests can simulate timeout / empty-stdout /
 * spawn-error without actually running semgrep.
 */
export function runSemgrepProcess(
	cwd: string,
	timeoutMs: number,
	paths: string[],
	spawnFn: SpawnFn = spawn,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawnFn(
			'semgrep',
			['scan', '--config', 'auto', '--json', ...paths],
			{cwd},
		);
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		let closed = false;

		// Mirrors execProcess's guard in source/tools/git/utils.ts: only arm a
		// kill-timer for a positive timeout, so a caller-supplied 0 (or
		// negative) means "no timeout" rather than "kill almost immediately".
		const timer =
			timeoutMs > 0
				? setTimeout(() => {
						timedOut = true;
						proc.kill('SIGTERM');
						const forceKillTimer = setTimeout(() => {
							if (!closed) proc.kill('SIGKILL');
						}, 1_000);
						forceKillTimer.unref();
					}, timeoutMs)
				: undefined;
		timer?.unref();

		proc.stdout.on('data', (data: Buffer) => {
			stdout += data.toString();
		});
		proc.stderr.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on('close', () => {
			closed = true;
			clearTimeout(timer);
			if (timedOut) {
				reject(new Error(`semgrep scan timed out after ${timeoutMs}ms`));
				return;
			}
			// semgrep exits non-zero for partial rule errors even when it still
			// emitted valid JSON results — prefer parsing over trusting exit code.
			if (stdout.trim()) {
				resolve(stdout);
			} else {
				reject(new Error(stderr.trim() || 'semgrep produced no output'));
			}
		});

		proc.on('error', error => {
			closed = true;
			clearTimeout(timer);
			reject(new Error(`Failed to execute semgrep: ${error.message}`));
		});
	});
}

/** Compact summary for injection into a subagent's task context. */
export function formatFindingsForPrompt(result: SecurityScanResult): string {
	if (!result.available) {
		return 'semgrep is not installed — no static analysis findings available.';
	}
	if (!result.ranSuccessfully) {
		return `semgrep scan failed to run (${result.errorMessage ?? 'unknown error'}) — no static analysis findings available.`;
	}
	if (result.findings.length === 0) {
		return 'semgrep found no issues.';
	}
	const lines = result.findings.map(
		f =>
			`[${f.severity}] ${f.path}:${f.startLine} (${f.ruleId}) — ${f.message}`,
	);
	if (result.totalFound > result.findings.length) {
		lines.push(
			`… showing ${result.findings.length} of ${result.totalFound} findings (capped, sorted by severity).`,
		);
	}
	return lines.join('\n');
}

/** Markdown section for the posted/printed review body. */
export function formatFindingsSection(result: SecurityScanResult): string {
	if (!result.available) {
		return '_semgrep is not installed — static analysis was skipped. Install with `pip install semgrep` or `brew install semgrep` to enable it._';
	}
	if (!result.ranSuccessfully) {
		return `_semgrep scan failed to run: ${result.errorMessage ?? 'unknown error'}_`;
	}
	if (result.findings.length === 0) {
		return 'No findings.';
	}
	const lines = result.findings.map(
		f =>
			`- **[${f.severity}]** \`${f.path}:${f.startLine}\` (${f.ruleId}) — ${f.message}`,
	);
	if (result.totalFound > result.findings.length) {
		lines.push(
			`\n_Showing ${result.findings.length} of ${result.totalFound} findings (capped, sorted by severity)._`,
		);
	}
	return lines.join('\n');
}
