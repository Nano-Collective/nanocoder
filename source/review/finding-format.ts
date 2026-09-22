/**
 * Finding and verdict contract for the agentic review pipeline.
 *
 * Findings come back from the finder subagent as FINDING blocks; verdicts
 * come back from verifier subagents as VERDICT blocks. The format is
 * deliberately line-oriented plain text: small local models handle it more
 * reliably than JSON, and the parser tolerates markdown decoration the model
 * may wrap around it.
 *
 * Every parsed finding gets a stable ID at parse time (F1, F2, ... in output
 * order). Verdicts echo that ID, and verdict application matches on it. This
 * binds a verdict to the exact claim it judged: two different findings on the
 * same file:line can never inherit each other's verdict, which a file:line
 * key alone cannot guarantee.
 */

export const REVIEW_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const REVIEW_VERDICTS = ['CONFIRM', 'REJECT', 'INSUFFICIENT'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export interface ReviewFinding {
	/** Stable ID assigned at parse time (F1, F2, ...). */
	id: string;
	file: string;
	line: number;
	severity: ReviewSeverity;
	issue: string;
	evidence: string;
}

export interface ReviewVerdictResult {
	/** The finding ID this verdict judges. */
	id: string;
	verdict: ReviewVerdict;
	reason: string;
}

export interface ParsedFindings {
	findings: ReviewFinding[];
	/** Free-text blocks that looked like findings but lacked required fields. */
	discarded: string[];
	/** True when the output contained no finding markers and no parsable fields. */
	unparseable: boolean;
}

export interface ParsedVerdicts {
	verdicts: ReviewVerdictResult[];
	discarded: string[];
}

/**
 * Normalise a cited path so it can be resolved against the project root.
 * Syntactic only: rejects empty paths, absolute paths, home-relative paths,
 * and traversal. Does not touch the filesystem.
 */
export function normaliseCitationPath(raw: string): string | null {
	const path = raw.trim().replaceAll('\\', '/');
	if (path.startsWith('./')) {
		return normaliseCitationPath(path.slice(2));
	}
	if (
		path.length === 0 ||
		path.startsWith('/') ||
		path.startsWith('~/') ||
		path.split('/').includes('..')
	) {
		return null;
	}
	return path;
}

function parseSeverity(raw: string): ReviewSeverity | null {
	const value = raw.trim().toLowerCase();
	return (REVIEW_SEVERITIES as readonly string[]).includes(value)
		? (value as ReviewSeverity)
		: null;
}

function parseVerdict(raw: string): ReviewVerdict | null {
	const value = raw.trim().toUpperCase();
	return (REVIEW_VERDICTS as readonly string[]).includes(value)
		? (value as ReviewVerdict)
		: null;
}

function parseLineNumber(raw: string): number | null {
	const value = raw.trim();
	if (!/^\d+$/.test(value)) {
		return null;
	}
	const line = Number.parseInt(value, 10);
	return line > 0 && Number.isSafeInteger(line) ? line : null;
}

/**
 * Strip markdown decoration a model may wrap fields in: bullets, bold, and
 * backticks. Keeps the parser usable with small models without loosening
 * what the fields themselves must contain.
 */
function cleanFieldValue(raw: string): string {
	return raw
		.trim()
		.replace(/^[-*+]\s+/, '')
		.replaceAll('**', '')
		.replaceAll('`', '')
		.trim();
}

/**
 * Extract a field value from one block of lines. Keys match
 * case-insensitively; the first match wins.
 */
function fieldValue(block: string[], key: string): string | null {
	const prefix = `${key}:`;
	for (const line of block) {
		const cleaned = cleanFieldValue(line);
		if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
			const value = cleaned.slice(prefix.length).trim();
			return value.length > 0 ? value : null;
		}
	}
	return null;
}

/**
 * Split raw output into candidate blocks. FINDING/END markers win when
 * present; otherwise every FILE field starts a new block so markerless
 * output still parses.
 */
function candidateBlocks(output: string, marker: string): string[][] {
	const lines = output.split(/\r?\n/);
	const blocks: string[][] = [];
	let current: string[] | null = null;
	let markerOpen = false;

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.toUpperCase() === marker) {
			current = [];
			markerOpen = true;
			continue;
		}
		if (trimmed.toUpperCase() === 'END' && markerOpen) {
			if (current) blocks.push(current);
			current = null;
			markerOpen = false;
			continue;
		}
		if (current) {
			current.push(line);
			continue;
		}
		// Markerless output: a FILE field starts a block.
		if (cleanFieldValue(line).toUpperCase().startsWith('FILE:')) {
			current = [line];
			markerOpen = false;
		}
	}
	if (current && current.length > 0) {
		blocks.push(current);
	}
	return blocks;
}

/** Parse finder output into findings with stable IDs. */
export function parseFindings(output: string): ParsedFindings {
	const findings: ReviewFinding[] = [];
	const discarded: string[] = [];
	const blocks = candidateBlocks(output, 'FINDING');

	for (const block of blocks) {
		const fileRaw = fieldValue(block, 'FILE');
		const lineRaw = fieldValue(block, 'LINE');
		const severityRaw = fieldValue(block, 'SEVERITY');
		const issue = fieldValue(block, 'ISSUE');
		const evidence = fieldValue(block, 'EVIDENCE');

		const file = fileRaw ? normaliseCitationPath(fileRaw) : null;
		const line = lineRaw ? parseLineNumber(lineRaw) : null;
		const severity = severityRaw ? parseSeverity(severityRaw) : null;

		if (!file || !line || !severity || !issue || !evidence) {
			discarded.push(block.join('\n').trim());
			continue;
		}

		findings.push({
			id: `F${findings.length + 1}`,
			file,
			line,
			severity,
			issue,
			evidence,
		});
	}

	return {findings, discarded, unparseable: blocks.length === 0};
}

/** Parse verifier output into verdicts. */
export function parseVerdicts(output: string): ParsedVerdicts {
	const verdicts: ReviewVerdictResult[] = [];
	const discarded: string[] = [];

	for (const block of output.split(/\r?\n\r?\n/)) {
		const lines = block.split(/\r?\n/);
		const idRaw = fieldValue(lines, 'ID');
		const verdictRaw = fieldValue(lines, 'VERDICT');
		const reason = fieldValue(lines, 'REASON');

		const id = idRaw?.trim() ?? null;
		const verdict = verdictRaw ? parseVerdict(verdictRaw) : null;

		if (!id || !verdict || !reason) {
			if (block.trim().length > 0 && (verdictRaw || idRaw)) {
				discarded.push(block.trim());
			}
			continue;
		}

		verdicts.push({id, verdict, reason});
	}

	return {verdicts, discarded};
}

/**
 * Apply verdicts to findings, matching on the finding ID. A finding whose
 * verdict never arrived, or whose verdict names a different ID, is unverified
 * — it can never inherit another finding's verdict, even when both cite the
 * same file:line.
 */
export function applyVerdicts(
	findings: ReviewFinding[],
	verdicts: ReviewVerdictResult[],
): {
	confirmed: ReviewFinding[];
	dropped: Array<{
		finding: ReviewFinding;
		verdict: ReviewVerdict | 'UNVERIFIED';
		reason: string;
	}>;
} {
	const byId = new Map<string, ReviewVerdictResult>();
	for (const verdict of verdicts) {
		// First verdict for an ID wins; duplicates are ignored rather than
		// giving a later, unrequested verdict the power to overwrite.
		if (!byId.has(verdict.id)) {
			byId.set(verdict.id, verdict);
		}
	}

	const confirmed: ReviewFinding[] = [];
	const dropped: Array<{
		finding: ReviewFinding;
		verdict: ReviewVerdict | 'UNVERIFIED';
		reason: string;
	}> = [];

	for (const finding of findings) {
		const verdict = byId.get(finding.id);
		if (!verdict) {
			dropped.push({finding, verdict: 'UNVERIFIED', reason: 'no verdict'});
			continue;
		}
		if (verdict.verdict === 'CONFIRM') {
			confirmed.push(finding);
		} else {
			dropped.push({
				finding,
				verdict: verdict.verdict,
				reason: verdict.reason,
			});
		}
	}

	return {confirmed, dropped};
}

/** The verifier's view of one finding: what it must judge and echo back. */
export function formatFinding(finding: ReviewFinding): string {
	return [
		`ID: ${finding.id}`,
		`FILE: ${finding.file}`,
		`LINE: ${finding.line}`,
		`SEVERITY: ${finding.severity}`,
		`ISSUE: ${finding.issue}`,
		`EVIDENCE: ${finding.evidence}`,
	].join('\n');
}
