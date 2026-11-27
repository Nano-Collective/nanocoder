/**
 * Line-oriented contracts between the review finder, the verifiers, and the
 * deterministic pipeline. Plain text is used instead of JSON because it is
 * more reliable across the local models Nanocoder supports.
 */

export const REVIEW_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const REVIEW_VERDICTS = ['CONFIRM', 'REJECT', 'INSUFFICIENT'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/** Verifier confidence (0-100) required before a confirmed finding is shown. */
export const REVIEW_CONFIDENCE_THRESHOLD = 80;

/** Sentinel the finder must emit when it has nothing to report. */
export const NO_FINDINGS_SENTINEL = 'NO FINDINGS';

const MAX_FIELD_LENGTH = 600;

export interface ReviewFinding {
	id: string;
	file: string;
	line: number;
	severity: ReviewSeverity;
	issue: string;
	evidence: string;
}

export interface ReviewVerdictResult {
	id: string;
	verdict: ReviewVerdict;
	confidence: number;
	reason: string;
}

export interface VerifiedFinding extends ReviewFinding {
	confidence: number;
	verificationReason: string;
}

export type DroppedFindingReason =
	| 'malformed'
	| 'citation'
	| 'rejected'
	| 'insufficient'
	| 'low-confidence';

export interface DroppedFinding {
	reason: DroppedFindingReason;
	detail: string;
	finding?: ReviewFinding;
	raw?: string;
}

export interface ParsedFindings {
	findings: ReviewFinding[];
	malformed: string[];
	declaredNone: boolean;
}

function clip(value: string): string {
	return value.length > MAX_FIELD_LENGTH
		? `${value.slice(0, MAX_FIELD_LENGTH - 1)}…`
		: value;
}

/** Normalize a model citation to a repository-relative path, or reject it. */
export function normalizeCitationPath(raw: string): string | null {
	let path = raw.trim().replaceAll('\\', '/');
	while (path.startsWith('./')) path = path.slice(2);
	if (
		path.length === 0 ||
		path.startsWith('/') ||
		path.startsWith('~') ||
		/^[a-zA-Z]:\//.test(path) ||
		path.includes('\0') ||
		path.split('/').some(part => part === '..' || part === '')
	) {
		return null;
	}
	return path;
}

function cleanLine(raw: string): string {
	return raw
		.trim()
		.replace(/^[-*+]\s+/, '')
		.replaceAll('**', '')
		.replaceAll('`', '')
		.trim();
}

function fieldValue(block: string[], key: string): string | null {
	const prefix = `${key.toLowerCase()}:`;
	for (const line of block) {
		const cleaned = cleanLine(line);
		if (cleaned.toLowerCase().startsWith(prefix)) {
			const value = cleaned.slice(prefix.length).trim();
			return value ? clip(value) : null;
		}
	}
	return null;
}

function parsePositiveInteger(raw: string | null): number | null {
	if (!raw) return null;
	const match = raw.match(/^(\d+)/);
	if (!match?.[1]) return null;
	const value = Number(match[1]);
	return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Split a `path:line` citation. Models often put both in FILE, or a range in
 * LINE; both are accepted and reduced to the first cited line.
 */
function splitCitation(
	fileRaw: string | null,
	lineRaw: string | null,
): {file: string | null; line: number | null} {
	let fileText = fileRaw;
	let line = parsePositiveInteger(lineRaw);
	const embedded = fileText?.match(/^(.*?):(\d+)(?:[-–]\d+)?$/);
	if (embedded?.[1] && embedded[2]) {
		fileText = embedded[1];
		line ??= parsePositiveInteger(embedded[2]);
	}
	return {
		file: fileText ? normalizeCitationPath(fileText) : null,
		line,
	};
}

function parseSeverity(raw: string | null): ReviewSeverity | null {
	const severity = raw?.trim().toLowerCase();
	return severity && (REVIEW_SEVERITIES as readonly string[]).includes(severity)
		? (severity as ReviewSeverity)
		: null;
}

function findingBlocks(output: string): string[][] {
	const blocks: string[][] = [];
	let current: string[] | null = null;
	for (const line of output.split(/\r?\n/)) {
		const marker = cleanLine(line).toUpperCase();
		if (marker === 'FINDING' || /^FINDING\s+#?\d+:?$/.test(marker)) {
			if (current?.length) blocks.push(current);
			current = [];
			continue;
		}
		if (marker === 'END') {
			if (current?.length) blocks.push(current);
			current = null;
			continue;
		}
		if (marker.startsWith('FILE:') && current && fieldValue(current, 'FILE')) {
			blocks.push(current);
			current = [line];
			continue;
		}
		if (current) {
			current.push(line);
		} else if (marker.startsWith('FILE:')) {
			current = [line];
		}
	}
	if (current?.length) blocks.push(current);
	return blocks;
}

export function parseFindings(output: string): ParsedFindings {
	const findings: ReviewFinding[] = [];
	const malformed: string[] = [];
	for (const block of findingBlocks(output)) {
		const {file, line} = splitCitation(
			fieldValue(block, 'FILE'),
			fieldValue(block, 'LINE'),
		);
		const severity = parseSeverity(fieldValue(block, 'SEVERITY'));
		const issue = fieldValue(block, 'ISSUE');
		const evidence = fieldValue(block, 'EVIDENCE');
		if (!file || !line || !severity || !issue || !evidence) {
			malformed.push(clip(block.join('\n').trim()));
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
	const declaredNone =
		findings.length === 0 &&
		malformed.length === 0 &&
		output
			.split(/\r?\n/)
			.some(line => cleanLine(line).toUpperCase() === NO_FINDINGS_SENTINEL);
	return {findings, malformed, declaredNone};
}

/** Parse the single verdict block expected from a verifier run. */
export function parseVerdict(
	output: string,
	expectedId: string,
): ReviewVerdictResult | null {
	const lines = output.split(/\r?\n/);
	const id = fieldValue(lines, 'ID');
	const verdictRaw = fieldValue(lines, 'VERDICT')?.toUpperCase();
	const confidenceRaw = fieldValue(lines, 'CONFIDENCE');
	const reason = fieldValue(lines, 'REASON');
	const verdict = (REVIEW_VERDICTS as readonly string[]).find(
		candidate => verdictRaw?.startsWith(candidate) ?? false,
	) as ReviewVerdict | undefined;
	const confidenceMatch = confidenceRaw?.match(/^(\d+)/);
	const confidence = confidenceMatch?.[1] ? Number(confidenceMatch[1]) : null;
	if (
		(id !== null && id.toUpperCase() !== expectedId.toUpperCase()) ||
		!verdict ||
		confidence === null ||
		confidence > 100 ||
		!reason
	) {
		return null;
	}
	return {id: expectedId, verdict, confidence, reason};
}

export function severityRank(severity: ReviewSeverity): number {
	return REVIEW_SEVERITIES.indexOf(severity);
}

export function formatFindingForVerifier(finding: ReviewFinding): string {
	return [
		`ID: ${finding.id}`,
		`FILE: ${finding.file}`,
		`LINE: ${finding.line}`,
		`SEVERITY: ${finding.severity}`,
		`ISSUE: ${finding.issue}`,
		`CLAIMED EVIDENCE: ${finding.evidence}`,
	].join('\n');
}
