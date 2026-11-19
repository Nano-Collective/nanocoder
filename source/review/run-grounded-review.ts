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
import {
	buildPromptDiff,
	createReviewContextTools,
	describeChangedFiles,
} from './review-context';
import {
	type DroppedFinding,
	parseFindings,
	type ReviewFinding,
	type VerifiedFinding,
} from './review-findings';
import {buildFinderPrompt, FINDER_SYSTEM_PROMPT} from './review-prompts';
import {formatResolvedReviewScope, resolveReviewScope} from './review-resolver';
import {
	defaultReviewFoundationTools,
	type ReviewFoundationTools,
} from './review-tools';
import {verifyCitedFindings} from './review-verify';

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

	const verification = await verifyCitedFindings({
		findings: parsed.findings,
		snapshot,
		contextTools,
		client: options.client,
		toolMode: options.toolMode,
		activity,
		reviewSpan,
		budgets,
		scopeText,
		result,
		account,
		...(signal ? {signal} : {}),
	});
	if (verification === 'cancelled') return settle('cancelled');
	return settle(
		result.incompleteReasons.length > 0 ? 'incomplete' : 'completed',
	);
}
