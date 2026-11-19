import type {LLMClient} from '@/types/core';
import type {ReviewActivitySpan, ReviewActivityStore} from './review-activity';
import type {ReviewAgentOutcome, ReviewToolMode} from './review-agent';
import {runReviewAgent} from './review-agent';
import {checkCitation, citedExcerpt} from './review-citations';
import {type ReviewAgentTool, renderFileDiff} from './review-context';
import {
	formatFindingForVerifier,
	parseVerdict,
	REVIEW_CONFIDENCE_THRESHOLD,
	type ReviewFinding,
	severityRank,
} from './review-findings';
import {buildVerifierPrompt, VERIFIER_SYSTEM_PROMPT} from './review-prompts';
import type {ReviewTargetSnapshot} from './review-snapshot';
import type {
	GroundedReviewBudgets,
	GroundedReviewResult,
} from './run-grounded-review';

const MAX_VERIFIER_DIFF_LINES = 300;

function clipDiff(diff: string): string {
	const lines = diff.split('\n');
	return lines.length <= MAX_VERIFIER_DIFF_LINES
		? diff
		: `${lines.slice(0, MAX_VERIFIER_DIFF_LINES).join('\n')}\n[diff truncated; use review_diff or review_read_file]`;
}

export interface VerifyFindingsInput {
	findings: ReviewFinding[];
	snapshot: ReviewTargetSnapshot;
	contextTools: ReviewAgentTool[];
	client: LLMClient;
	toolMode: ReviewToolMode;
	activity: ReviewActivityStore;
	reviewSpan: ReviewActivitySpan;
	signal?: AbortSignal;
	budgets: GroundedReviewBudgets;
	scopeText: string;
	result: GroundedReviewResult;
	account: (outcome: ReviewAgentOutcome) => void;
}

/**
 * Drop findings whose citation misses the changed code, then run the
 * independent verifier on each survivor. Shared by the grounded and deep
 * tiers so both label budget, parse, and cancellation the same way.
 * Returns `cancelled` when the caller must stop; otherwise the review span
 * is already completed.
 */
export async function verifyCitedFindings(
	input: VerifyFindingsInput,
): Promise<'cancelled' | 'finished'> {
	const {result, budgets, snapshot, reviewSpan, signal} = input;
	const seen = new Set<string>();
	const cited: Array<{
		finding: ReviewFinding;
		snapshotFile: ReviewTargetSnapshot['files'][number];
	}> = [];
	for (const finding of input.findings) {
		const key = `${finding.file}:${finding.line}:${finding.issue.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const citation = checkCitation(snapshot, finding);
		if (!citation.ok) {
			result.dropped.push({
				reason: 'citation',
				detail: citation.reason,
				finding,
			});
			continue;
		}
		cited.push({finding, snapshotFile: citation.file});
	}
	cited.sort(
		(left, right) =>
			severityRank(left.finding.severity) -
			severityRank(right.finding.severity),
	);
	// Specialists often word one bug differently, so copies survive dedupe.
	// Spend the verification budget on every cited line before any repeats.
	const coveredLines = new Set<string>();
	const firstAtLine: typeof cited = [];
	const repeats: typeof cited = [];
	for (const entry of cited) {
		const location = `${entry.finding.file}:${entry.finding.line}`;
		if (coveredLines.has(location)) {
			repeats.push(entry);
		} else {
			coveredLines.add(location);
			firstAtLine.push(entry);
		}
	}
	cited.splice(0, cited.length, ...firstAtLine, ...repeats);

	reviewSpan.progress(
		cited.length === 0
			? 'No citable findings to verify'
			: `Verifying ${Math.min(cited.length, budgets.maxVerifications)} finding${cited.length === 1 ? '' : 's'}`,
	);

	// Unverified copies at a line that already has a verified finding are
	// usually the same bug in other words. Listing them as unverified would
	// mark the review incomplete, so keep them as notes instead.
	const foldUnverified = () => {
		const verifiedLines = new Set(
			result.findings.map(finding => `${finding.file}:${finding.line}`),
		);
		result.unverified = result.unverified.filter(entry => {
			const location = `${entry.finding.file}:${entry.finding.line}`;
			if (!verifiedLines.has(location)) return true;
			result.notes.push(
				`Unverified ${location} "${entry.finding.issue}" shares its line with a verified finding (${entry.reason}).`,
			);
			return false;
		});
	};

	for (const [index, {finding, snapshotFile}] of cited.entries()) {
		if (index >= budgets.maxVerifications) {
			result.unverified.push({
				finding,
				reason: `not verified: only ${budgets.maxVerifications} findings are verified per review`,
			});
			continue;
		}
		const verifier = await runReviewAgent({
			client: input.client,
			name: `verifier ${finding.id}`,
			summary: `Checking ${finding.file}:${finding.line}`,
			systemPrompt: VERIFIER_SYSTEM_PROMPT,
			userPrompt: buildVerifierPrompt({
				scope: input.scopeText,
				finding: formatFindingForVerifier(finding),
				excerpt: citedExcerpt(snapshotFile, finding.line),
				fileDiff: clipDiff(renderFileDiff(snapshotFile)),
			}),
			tools: input.contextTools,
			budget: budgets.verifier,
			toolMode: input.toolMode,
			activity: input.activity,
			parentId: reviewSpan.id,
			...(signal ? {signal} : {}),
		});
		input.account(verifier);
		result.stats.verifierRuns++;

		if (verifier.status === 'cancelled') {
			reviewSpan.cancel('Cancelled during verification');
			result.message =
				'Review cancelled during verification; results are partial.';
			for (const remaining of cited.slice(index)) {
				result.unverified.push({
					finding: remaining.finding,
					reason: 'not verified: review cancelled',
				});
			}
			foldUnverified();
			return 'cancelled';
		}

		if (verifier.incompleteReason) {
			result.unverified.push({
				finding,
				reason: verifier.incompleteReason,
			});
			continue;
		}
		const verdict = parseVerdict(verifier.output, finding.id);
		if (!verdict) {
			result.unverified.push({
				finding,
				reason:
					verifier.status === 'failed'
						? `verifier failed: ${verifier.error ?? 'unknown error'}`
						: verifier.status === 'budget-exhausted'
							? 'verifier reached its budget without a verdict'
							: 'verifier response could not be parsed',
			});
			continue;
		}
		if (verdict.verdict === 'CONFIRM') {
			if (verdict.confidence >= REVIEW_CONFIDENCE_THRESHOLD) {
				result.findings.push({
					...finding,
					confidence: verdict.confidence,
					verificationReason: verdict.reason,
				});
			} else {
				result.dropped.push({
					reason: 'low-confidence',
					detail: `confirmed with confidence ${verdict.confidence}, below ${REVIEW_CONFIDENCE_THRESHOLD}: ${verdict.reason}`,
					finding,
				});
			}
		} else {
			result.dropped.push({
				reason: verdict.verdict === 'REJECT' ? 'rejected' : 'insufficient',
				detail: verdict.reason,
				finding,
			});
		}
	}

	foldUnverified();
	if (result.unverified.length > 0) {
		result.incompleteReasons.push(
			`${result.unverified.length} cited finding${result.unverified.length === 1 ? ' was' : 's were'} not verified.`,
		);
	}
	const incomplete = result.incompleteReasons.length > 0;
	reviewSpan.complete(
		`${result.findings.length} verified finding${result.findings.length === 1 ? '' : 's'}${incomplete ? ' (incomplete)' : ''}`,
	);
	return 'finished';
}
