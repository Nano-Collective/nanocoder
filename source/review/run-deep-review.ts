import type {LLMClient} from '@/types/core';
import {ReviewActivityStore} from './review-activity';
import {type ReviewAgentOutcome, runReviewAgent} from './review-agent';
import {
	buildPromptDiff,
	createReviewContextTools,
	describeChangedFiles,
} from './review-context';
import {dedupeFindings, type SourcedFinding} from './review-dedupe';
import {parseFindings} from './review-findings';
import {FINDER_LENSES} from './review-lenses';
import {buildFinderPrompt, FINDER_SYSTEM_PROMPT} from './review-prompts';
import {formatResolvedReviewScope, resolveReviewScope} from './review-resolver';
import {defaultReviewFoundationTools} from './review-tools';
import {verifyCitedFindings} from './review-verify';
import {
	DEFAULT_GROUNDED_REVIEW_BUDGETS,
	type GroundedReviewOptions,
	type GroundedReviewResult,
	type GroundedReviewStatus,
} from './run-grounded-review';

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
 * `/review deep`: the same pinned scope, citation check, verifier, and
 * activity trace as the grounded review, with three specialist finders.
 * Each finder has its own tool budget. Matching citations are deduped before
 * verification so two lenses reporting one bug cost one verifier run.
 */
export async function runDeepReview(
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
		name: 'Deep review',
		summary: 'Investigating the pinned changes from three perspectives',
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

	const sourced: SourcedFinding[] = [];
	const inspected = new Set<string>();
	const fullyInspected = new Set<string>();
	let failedFinders = 0;

	for (const lens of FINDER_LENSES) {
		if (signal?.aborted) {
			reviewSpan.cancel('Cancelled before every finder finished');
			result.message = `Review cancelled before the ${lens.label} finder ran.`;
			for (const entry of sourced) {
				result.unverified.push({
					finding: entry.finding,
					reason: 'not verified: review cancelled',
				});
			}
			return settle('cancelled');
		}

		const finder = await runReviewAgent({
			client: options.client,
			name: `finder (${lens.label})`,
			summary: `Looking for ${lens.label}`,
			systemPrompt: FINDER_SYSTEM_PROMPT,
			userPrompt: buildFinderPrompt({
				scope: scopeText,
				changedFiles: describeChangedFiles(snapshot),
				diff: promptDiff.text,
				omittedPaths: promptDiff.omittedPaths,
				binaryPaths: promptDiff.binaryPaths,
				focus: lens.focus,
			}),
			tools: contextTools,
			budget: budgets.finder,
			toolMode: options.toolMode,
			activity,
			parentId: reviewSpan.id,
			...(signal ? {signal} : {}),
		});
		account(finder);
		for (const path of finder.inspectedPaths) inspected.add(path);
		for (const path of finder.fullyInspectedPaths) fullyInspected.add(path);

		if (finder.status === 'cancelled') {
			reviewSpan.cancel(`Cancelled during the ${lens.label} finder`);
			result.message = `Review cancelled during the ${lens.label} finder.`;
			for (const entry of sourced) {
				result.unverified.push({
					finding: entry.finding,
					reason: 'not verified: review cancelled',
				});
			}
			return settle('cancelled');
		}
		if (finder.status === 'failed') {
			failedFinders++;
			result.incompleteReasons.push(
				`The ${lens.label} finder failed: ${finder.error ?? 'unknown error'}`,
			);
			continue;
		}
		if (finder.status === 'budget-exhausted') {
			result.incompleteReasons.push(
				`The ${lens.label} finder reached its budget (${budgets.finder.maxToolCalls} tool calls, ${budgets.finder.maxTurns} model turns) before finishing; issues may be missing.`,
			);
		}
		if (finder.incompleteReason) {
			result.incompleteReasons.push(finder.incompleteReason);
		}

		const parsed = parseFindings(finder.output);
		result.stats.reported += parsed.findings.length + parsed.malformed.length;
		for (const raw of parsed.malformed) {
			result.dropped.push({
				reason: 'malformed',
				detail: `${lens.label} finder: missing FILE, LINE, SEVERITY, ISSUE, or EVIDENCE`,
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
					? `The ${lens.label} finder did not report in the required format, so its conclusion could not be read.`
					: `The ${lens.label} finder returned an empty report.`,
			);
		}
		sourced.push(
			...parsed.findings.map(finding => ({finding, lens: lens.label})),
		);
	}

	if (failedFinders === FINDER_LENSES.length) {
		reviewSpan.fail(
			result.incompleteReasons.join('; '),
			'Every specialist finder failed',
		);
		// Provider errors rarely end in a period, so a space-joined message
		// runs the three reasons together.
		result.message = result.incompleteReasons
			.map(reason => `- ${reason}`)
			.join('\n');
		result.incompleteReasons = [];
		return settle('failed');
	}

	const uninspected = promptDiff.omittedPaths.filter(
		path => !inspected.has(path),
	);
	if (uninspected.length > 0) {
		result.incompleteReasons.push(
			`${uninspected.length} changed file${uninspected.length === 1 ? ' was' : 's were'} too large for the initial diff and never inspected: ${listPaths(uninspected)}.`,
		);
	}
	for (const path of promptDiff.omittedPaths) {
		if (inspected.has(path) && !fullyInspected.has(path)) {
			result.incompleteReasons.push(
				`${path} was only partially inspected (a limited range or output truncated).`,
			);
		}
	}

	const {unique, duplicates} = dedupeFindings(sourced);
	for (const duplicate of duplicates) {
		result.notes.push(
			`Duplicate ${duplicate.finding.file}:${duplicate.finding.line} from ${duplicate.dropped} already covered by ${duplicate.kept}.`,
		);
	}

	const verification = await verifyCitedFindings({
		findings: unique.map(entry => entry.finding),
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
