import type {ReviewFinding} from './review-findings';

export interface SourcedFinding {
	finding: ReviewFinding;
	lens: string;
}

export interface DedupedFindings {
	unique: SourcedFinding[];
	duplicates: Array<{kept: string; dropped: string; finding: ReviewFinding}>;
}

function normalise(text: string): string {
	return text
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, ' ')
		.trim();
}

function similar(left: string, right: string): boolean {
	const a = normalise(left);
	const b = normalise(right);
	if (!a || !b) return false;
	return a === b;
}

/**
 * Collapse findings that cite the same line and describe the same issue.
 * The first lens to report it wins. Later copies are returned so the report
 * can say which perspective already covered them, and so they are not
 * verified twice.
 */
export function dedupeFindings(sourced: SourcedFinding[]): DedupedFindings {
	const unique: SourcedFinding[] = [];
	const duplicates: DedupedFindings['duplicates'] = [];
	for (const candidate of sourced) {
		const match = unique.find(
			kept =>
				kept.finding.file === candidate.finding.file &&
				kept.finding.line === candidate.finding.line &&
				similar(kept.finding.issue, candidate.finding.issue),
		);
		if (match) {
			duplicates.push({
				kept: match.lens,
				dropped: candidate.lens,
				finding: candidate.finding,
			});
		} else {
			unique.push(candidate);
		}
	}
	return {
		unique: unique.map((entry, index) => ({
			...entry,
			finding: {...entry.finding, id: `F${index + 1}`},
		})),
		duplicates,
	};
}
