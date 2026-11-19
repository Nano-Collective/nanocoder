import type {LLMClient} from '@/types/core';
import {
	ReviewActivityStore,
	type ReviewActivitySummary,
} from './review-activity';
import {
	type ReviewAgentBudget,
	type ReviewAgentOutcome,
	type ReviewToolMode,
	runReviewAgent,
} from './review-agent';
import {checkCitation, citedExcerpt} from './review-citations';
import {
	buildPromptDiff,
	createReviewContextTools,
	describeChangedFiles,
	renderFileDiff,
} from './review-context';
import {
	type DroppedFinding,
	formatFindingForVerifier,
	parseFindings,
	parseVerdict,
	REVIEW_CONFIDENCE_THRESHOLD,
	type ReviewFinding,
	severityRank,
	type VerifiedFinding,
} from './review-findings';
import {
	buildFinderPrompt,
	buildVerifierPrompt,
	FINDER_SYSTEM_PROMPT,
	VERIFIER_SYSTEM_PROMPT,
} from './review-prompts';
import {formatResolvedReviewScope, resolveReviewScope} from './review-resolver';
import type {ReviewTargetSnapshot} from './review-snapshot';
import {
	defaultReviewFoundationTools,
	type ReviewFoundationTools,
} from './review-tools';

export type GroundedReviewStatus =
	| 'completed'
	| 'incomplete'
	| 'failed'
	| 'cancelled'
	| 'clarification'
	| 'empty';

export interface UnverifiedFinding {
	finding: ReviewFinding;
	reason: string;
}

export interface GroundedReviewResult {
	status: GroundedReviewStatus;
	reviewId: string;
	/** One-line pinned scope (base, head, file count) once resolution succeeded. */
	scope?: string;
	message?: string;
	choices?: string[];
	findings: VerifiedFinding[];
	dropped: DroppedFinding[];
	unverified: UnverifiedFinding[];
	/** Why the result must not be read as a complete review. */
	incompleteReasons: string[];
	notes: string[];
	stats: {
		reported: number;
		verifierRuns: number;
		modelCalls: number;
		toolCalls: number;
	};
	activity: ReviewActivitySummary;
}

export interface GroundedReviewBudgets {
	finder: ReviewAgentBudget;
	verifier: ReviewAgentBudget;
	maxVerifications: number;
}

export const DEFAULT_GROUNDED_REVIEW_BUDGETS: GroundedReviewBudgets = {
	finder: {maxTurns: 14, maxToolCalls: 24},
	verifier: {maxTurns: 6, maxToolCalls: 8},
	maxVerifications: 8,
};

export interface GroundedReviewOptions {
	/** Review request text, e.g. `"PR 42"` or `"branch feature/x"`. */
	request: string;
	client: LLMClient;
	toolMode: ReviewToolMode;
	activity?: ReviewActivityStore;
	signal?: AbortSignal;
	tools?: ReviewFoundationTools;
	budgets?: GroundedReviewBudgets;
	now?: () => number;
}

const MAX_PROMPT_DIFF_LINES = 1500;
const MAX_VERIFIER_DIFF_LINES = 300;

function promptDiffLimits(client: LLMClient): {
	maxLines: number;
	maxChars: number;
} {
	const contextTokens = client.getContextSize();
	const maxChars =
		contextTokens > 0
			? Math.min(80_000, Math.max(6_000, Math.floor(contextTokens * 4 * 0.3)))
			: 60_000;
	return {maxLines: MAX_PROMPT_DIFF_LINES, maxChars};
}

function listPaths(paths: string[], limit = 5): string {
	const shown = paths.slice(0, limit).join(', ');
	return paths.length > limit
		? `${shown}, and ${paths.length - limit} more`
		: shown;
}

function clipDiff(diff: string): string {
	const lines = diff.split('\n');
	return lines.length <= MAX_VERIFIER_DIFF_LINES
		? diff
		: `${lines.slice(0, MAX_VERIFIER_DIFF_LINES).join('\n')}\n[diff truncated; use review_diff or review_read_file]`;
}

/**
 * Run the default grounded review: pin the requested scope, let a read-only
 * finder investigate it, drop findings whose `file:line` does not point at the
 * changed code, then have an independent verifier re-check each survivor.
 * Budget, coverage, and verification gaps are reported as `incomplete` so a
 * partial run is never presented as a clean review.
 */
export async function runGroundedReview(
	options: GroundedReviewOptions,
): Promise<GroundedReviewResult> {
	const tools = options.tools ?? defaultReviewFoundationTools;
	const budgets = options.budgets ?? DEFAULT_GROUNDED_REVIEW_BUDGETS;
	const activity =
		options.activity ??
		new ReviewActivityStore(options.now ? {now: options.now} : {});
	const {signal} = options;
	const result: GroundedReviewResult = {
		status: 'completed',
		reviewId: activity.reviewId,
		findings: [],
		dropped: [],
		unverified: [],
		incompleteReasons: [],
		notes: [],
		stats: {reported: 0, verifierRuns: 0, modelCalls: 0, toolCalls: 0},
		activity: activity.toSummary(),
	};
	const settle = (status: GroundedReviewStatus): GroundedReviewResult => {
		result.status = status;
		activity.finish(
			status === 'failed'
				? 'failed'
				: status === 'cancelled'
					? 'cancelled'
					: 'completed',
		);
		result.activity = activity.toSummary();
		return result;
	};

	const resolution = await resolveReviewScope(options.request, {
		tools,
		activity,
		keepActivityOpen: true,
		...(signal ? {signal} : {}),
		...(options.now ? {now: options.now} : {}),
	});
	if (resolution.status !== 'ready') {
		result.message = resolution.message;
		if (resolution.status === 'clarification') {
			result.choices = resolution.choices;
			return settle('clarification');
		}
		return settle(resolution.status);
	}

	const snapshot = resolution.snapshot;
	result.scope = formatResolvedReviewScope(snapshot);
	if (snapshot.files.length === 0) {
		result.message = `No changes to review in ${snapshot.scope.description}.`;
		return settle('empty');
	}

	const reviewSpan = activity.begin({
		source: 'review',
		name: 'Grounded review',
		summary: 'Investigating the pinned changes',
	});
	const account = (outcome: ReviewAgentOutcome) => {
		result.stats.modelCalls += outcome.turns;
		result.stats.toolCalls += outcome.toolCalls;
	};
	const contextTools = createReviewContextTools(snapshot, tools);
	const scopeText = snapshot.scope.description;

	const promptDiff = buildPromptDiff(
		snapshot,
		promptDiffLimits(options.client),
	);
	if (promptDiff.binaryPaths.length > 0) {
		result.notes.push(
			`Binary files are not reviewed as text: ${listPaths(promptDiff.binaryPaths)}.`,
		);
	}

	const finder = await runReviewAgent({
		client: options.client,
		name: 'finder',
		summary: 'Looking for defects in the changed code',
		systemPrompt: FINDER_SYSTEM_PROMPT,
		userPrompt: buildFinderPrompt({
			scope: scopeText,
			changedFiles: describeChangedFiles(snapshot),
			diff: promptDiff.text,
			omittedPaths: promptDiff.omittedPaths,
			binaryPaths: promptDiff.binaryPaths,
		}),
		tools: contextTools,
		budget: budgets.finder,
		toolMode: options.toolMode,
		activity,
		parentId: reviewSpan.id,
		...(signal ? {signal} : {}),
	});
	account(finder);
	if (finder.incompleteReason) {
		result.incompleteReasons.push(finder.incompleteReason);
	}

	if (finder.status === 'cancelled') {
		reviewSpan.cancel('Cancelled while the finder was running');
		result.message = 'Review cancelled before the finder finished.';
		return settle('cancelled');
	}
	if (finder.status === 'failed') {
		reviewSpan.fail(finder.error ?? 'finder failed', 'The finder failed');
		result.message = `The finder failed: ${finder.error ?? 'unknown error'}`;
		return settle('failed');
	}
	if (finder.status === 'budget-exhausted') {
		result.incompleteReasons.push(
			`The finder reached its budget (${budgets.finder.maxToolCalls} tool calls, ${budgets.finder.maxTurns} model turns) before finishing; issues may be missing.`,
		);
	}

	const uninspected = promptDiff.omittedPaths.filter(
		path => !finder.inspectedPaths.has(path),
	);
	if (uninspected.length > 0) {
		result.incompleteReasons.push(
			`${uninspected.length} changed file${uninspected.length === 1 ? ' was' : 's were'} too large for the initial diff and never inspected: ${listPaths(uninspected)}.`,
		);
	}
	for (const path of promptDiff.omittedPaths) {
		if (
			finder.inspectedPaths.has(path) &&
			!finder.fullyInspectedPaths.has(path)
		) {
			result.incompleteReasons.push(
				`${path} was only partially inspected (a limited range or output truncated).`,
			);
		}
	}

	const parsed = parseFindings(finder.output);
	result.stats.reported = parsed.findings.length + parsed.malformed.length;
	for (const raw of parsed.malformed) {
		result.dropped.push({
			reason: 'malformed',
			detail: 'missing FILE, LINE, SEVERITY, ISSUE, or EVIDENCE',
			raw,
		});
	}
	if (
		parsed.findings.length === 0 &&
		parsed.malformed.length === 0 &&
		!parsed.declaredNone
	) {
		result.incompleteReasons.push(
			finder.output.trim()
				? 'The finder did not report in the required format, so its conclusion could not be read.'
				: 'The finder returned an empty report.',
		);
	}

	const seen = new Set<string>();
	const cited: Array<{
		finding: ReviewFinding;
		snapshotFile: ReviewTargetSnapshot['files'][number];
	}> = [];
	for (const finding of parsed.findings) {
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

	reviewSpan.progress(
		cited.length === 0
			? 'No citable findings to verify'
			: `Verifying ${Math.min(cited.length, budgets.maxVerifications)} finding${cited.length === 1 ? '' : 's'}`,
	);

	for (const [index, {finding, snapshotFile}] of cited.entries()) {
		if (index >= budgets.maxVerifications) {
			result.unverified.push({
				finding,
				reason: `not verified: only ${budgets.maxVerifications} findings are verified per review`,
			});
			continue;
		}
		const verifier = await runReviewAgent({
			client: options.client,
			name: `verifier ${finding.id}`,
			summary: `Checking ${finding.file}:${finding.line}`,
			systemPrompt: VERIFIER_SYSTEM_PROMPT,
			userPrompt: buildVerifierPrompt({
				scope: scopeText,
				finding: formatFindingForVerifier(finding),
				excerpt: citedExcerpt(snapshotFile, finding.line),
				fileDiff: clipDiff(renderFileDiff(snapshotFile)),
			}),
			tools: contextTools,
			budget: budgets.verifier,
			toolMode: options.toolMode,
			activity,
			parentId: reviewSpan.id,
			...(signal ? {signal} : {}),
		});
		account(verifier);
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
			return settle('cancelled');
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

	if (result.unverified.length > 0) {
		result.incompleteReasons.push(
			`${result.unverified.length} cited finding${result.unverified.length === 1 ? ' was' : 's were'} not verified.`,
		);
	}

	const incomplete = result.incompleteReasons.length > 0;
	reviewSpan.complete(
		`${result.findings.length} verified finding${result.findings.length === 1 ? '' : 's'}${incomplete ? ' (incomplete)' : ''}`,
	);
	return settle(incomplete ? 'incomplete' : 'completed');
}
