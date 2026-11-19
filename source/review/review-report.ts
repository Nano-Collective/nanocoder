import type {DroppedFinding} from './review-findings';
import type {GroundedReviewResult} from './run-grounded-review';

const DROPPED_LABELS: Record<DroppedFinding['reason'], string> = {
	malformed: 'unreadable',
	citation: 'bad citation',
	rejected: 'rejected',
	insufficient: 'could not be verified',
	'low-confidence': 'low confidence',
};

function headline(result: GroundedReviewResult): string {
	const count = result.findings.length;
	const plural = count === 1 ? '' : 's';
	switch (result.status) {
		case 'completed':
			return count === 0
				? 'No verified issues found in the reviewed scope.'
				: `${count} verified issue${plural} found.`;
		case 'incomplete':
			return count === 0
				? '**Review incomplete.** No issue was verified, but this is not a clean review: see why below.'
				: `**Review incomplete.** ${count} verified issue${plural} so far; others may be missing.`;
		case 'cancelled':
			return '**Review cancelled.** Results are partial.';
		case 'failed':
			return '**Review failed.**';
		case 'clarification':
			return '**Review scope needs clarification.**';
		case 'empty':
			return 'Nothing to review.';
	}
}

function title(result: GroundedReviewResult, tier: string): string {
	const status =
		result.status === 'clarification'
			? 'needs a target'
			: result.status === 'empty'
				? 'no changes'
				: result.status;
	return `## ${tier} review · ${status}`;
}

/**
 * Render a grounded review as Markdown so it displays like normal assistant
 * output. The headline never says "no issues" unless the run completed.
 */
export function renderGroundedReviewReport(
	result: GroundedReviewResult,
	tier = 'Grounded',
): string {
	const sections = [title(result, tier)];
	if (result.scope) sections.push(result.scope);
	sections.push(headline(result));
	if (result.message) sections.push(result.message);
	if (result.choices?.length) {
		sections.push(result.choices.map(choice => `- ${choice}`).join('\n'));
	}

	if (result.findings.length > 0) {
		sections.push(
			[
				'### Findings',
				...result.findings.map((finding, index) =>
					[
						`${index + 1}. **${finding.severity.toUpperCase()}** \`${finding.file}:${finding.line}\` ${finding.issue}`,
						`   - Evidence: ${finding.evidence}`,
						`   - Verified (confidence ${finding.confidence}): ${finding.verificationReason}`,
					].join('\n'),
				),
			].join('\n'),
		);
	}

	if (result.incompleteReasons.length > 0) {
		sections.push(
			[
				'### Why this review is incomplete',
				...result.incompleteReasons.map(reason => `- ${reason}`),
			].join('\n'),
		);
	}

	if (result.unverified.length > 0) {
		sections.push(
			[
				'### Unverified findings',
				...result.unverified.map(
					entry =>
						`- \`${entry.finding.file}:${entry.finding.line}\` ${entry.finding.issue} (${entry.reason})`,
				),
			].join('\n'),
		);
	}

	if (result.dropped.length > 0) {
		sections.push(
			[
				'### Dropped',
				...result.dropped.map(entry => {
					const label = DROPPED_LABELS[entry.reason];
					return entry.finding
						? `- \`${entry.finding.file}:${entry.finding.line}\` ${entry.finding.issue} (${label}: ${entry.detail})`
						: `- Finder output (${label}: ${entry.detail})`;
				}),
			].join('\n'),
		);
	}

	if (result.notes.length > 0) {
		sections.push(result.notes.map(note => `- ${note}`).join('\n'));
	}

	if (result.stats.modelCalls > 0) {
		sections.push(
			`*${result.stats.modelCalls} model call${result.stats.modelCalls === 1 ? '' : 's'} · ${result.stats.toolCalls} tool call${result.stats.toolCalls === 1 ? '' : 's'} · ${result.stats.verifierRuns} verifier run${result.stats.verifierRuns === 1 ? '' : 's'} · review ${result.reviewId.slice(0, 8)}*`,
		);
	}
	return sections.join('\n\n');
}
