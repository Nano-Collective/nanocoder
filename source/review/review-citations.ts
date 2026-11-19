import type {ReviewFinding} from './review-findings';
import type {ReviewFileSnapshot, ReviewTargetSnapshot} from './review-snapshot';

/** How far (in lines) a citation may sit from a changed line in the head. */
const CITATION_CHANGE_WINDOW = 3;

export type CitationCheck =
	| {ok: true; file: ReviewFileSnapshot}
	| {ok: false; reason: string};

export function splitContentLines(content: string): string[] {
	const lines = content.split('\n');
	if (lines.at(-1) === '') lines.pop();
	return lines;
}

/**
 * Check a finding's `file:line` against the pinned snapshot. Citations must
 * point at an existing line of a changed text file in the reviewed head, in
 * or near a changed line, so a finding cannot be about unrelated code.
 */
export function checkCitation(
	snapshot: ReviewTargetSnapshot,
	finding: Pick<ReviewFinding, 'file' | 'line'>,
): CitationCheck {
	const file = snapshot.files.find(
		candidate => candidate.path === finding.file,
	);
	if (!file) {
		return {
			ok: false,
			reason: `${finding.file} is not a changed file in the reviewed scope`,
		};
	}
	if (file.isBinary) {
		return {ok: false, reason: `${finding.file} is a binary file`};
	}
	if (file.headContent === null) {
		return {
			ok: false,
			reason: `${finding.file} was deleted in this scope, so no head line can be cited`,
		};
	}
	const lineCount = splitContentLines(file.headContent).length;
	if (finding.line > lineCount) {
		return {
			ok: false,
			reason: `line ${finding.line} is past the end of ${finding.file} (${lineCount} lines)`,
		};
	}
	const anchors = [
		...file.lineMap.changedHeadLines,
		...(file.lineMap.headDeletionAnchors ?? []),
	];
	const nearChange = anchors.some(
		line => Math.abs(line - finding.line) <= CITATION_CHANGE_WINDOW,
	);
	if (!nearChange) {
		return {
			ok: false,
			reason: `line ${finding.line} is not in or near a changed line of ${finding.file}`,
		};
	}
	return {ok: true, file};
}

/** Numbered head-content excerpt around a line, for verifier prompts. */
export function citedExcerpt(
	file: ReviewFileSnapshot,
	line: number,
	radius = 8,
): string {
	if (file.headContent === null) return '';
	const lines = splitContentLines(file.headContent);
	const start = Math.max(1, line - radius);
	const end = Math.min(lines.length, line + radius);
	const width = String(end).length;
	const excerpt: string[] = [];
	for (let current = start; current <= end; current++) {
		const marker = current === line ? '>' : ' ';
		excerpt.push(
			`${marker}${String(current).padStart(width)}: ${lines[current - 1] ?? ''}`,
		);
	}
	return excerpt.join('\n');
}
