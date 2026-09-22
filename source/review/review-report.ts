/**
 * Report rendering for the agentic review tiers.
 *
 * The pipeline returns structured results; this turns them into the markdown
 * the user sees in the chat. Dropped findings are summarised so nothing the
 * finder claimed silently vanishes.
 */

import type {ReviewFinding} from './finding-format.js';
import type {
	DefaultReviewResult,
	DroppedFinding,
} from './run-default-review.js';

const SEVERITY_ORDER: Record<string, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
};

function sortBySeverity(findings: ReviewFinding[]): ReviewFinding[] {
	return [...findings].sort(
		(a, b) =>
			(SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
	);
}

function renderFinding(finding: ReviewFinding): string {
	return [
		`- **${finding.severity.toUpperCase()}** \`${finding.file}:${finding.line}\` — ${finding.issue}`,
		`  Evidence: ${finding.evidence}`,
	].join('\n');
}

function renderDropped(dropped: DroppedFinding[]): string {
	const byVerdict = new Map<string, DroppedFinding[]>();
	for (const entry of dropped) {
		const list = byVerdict.get(entry.verdict) ?? [];
		list.push(entry);
		byVerdict.set(entry.verdict, list);
	}

	const lines: string[] = [];
	for (const verdict of ['REJECT', 'INSUFFICIENT', 'UNVERIFIED']) {
		const entries = byVerdict.get(verdict);
		if (!entries || entries.length === 0) continue;
		lines.push(`- **${verdict}** (${entries.length}):`);
		for (const entry of entries) {
			lines.push(
				`  - \`${entry.finding.file}:${entry.finding.line}\` — ${entry.finding.issue} (${entry.reason})`,
			);
		}
	}
	return lines.join('\n');
}

/** Render the default/deep tier result as the chat report. */
export function renderReviewReport(
	result: DefaultReviewResult,
	targetDescription: string,
): string {
	const sections: string[] = [];

	sections.push(`## Agentic review — ${targetDescription}`);

	if (result.confirmed.length > 0) {
		sections.push('### Verified findings');
		for (const finding of sortBySeverity(result.confirmed)) {
			sections.push(renderFinding(finding));
		}
	} else {
		sections.push('**No verified issues found.**');
	}

	if (result.dropped.length > 0) {
		sections.push('### Dropped findings');
		sections.push(renderDropped(result.dropped));
	}

	if (result.notes.length > 0) {
		sections.push('### Notes');
		for (const note of result.notes) {
			sections.push(`- ${note}`);
		}
	}

	const totalTokens = result.usage.finder + result.usage.verifier;
	if (totalTokens > 0) {
		sections.push(
			`_Approximate token usage: finder ${result.usage.finder}, verifiers ${result.usage.verifier} (streamed-progress estimate)._`,
		);
	}

	return sections.join('\n\n');
}
