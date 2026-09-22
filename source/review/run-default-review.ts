/**
 * The default agentic review pipeline: finder -> citation validation ->
 * independent verifier per finding -> CONFIRM-only report.
 *
 * Design constraints:
 * - Bounded: the finder and every verifier run under tool-call and turn
 *   budgets; at most maxVerifiedFindings findings get verified.
 * - Independent: the verifier sees one finding and the target context, never
 *   the finder's transcript or conversation.
 * - Honest: usage is approximate (streamed-progress counts); unverified and
 *   dropped findings are reported, never silently discarded; a failed finder
 *   run still parses whatever partial output it produced.
 */

import type {SubagentExecutionLimits} from '@/subagents/subagent-executor.js';
import type {SubagentLoader} from '@/subagents/subagent-loader.js';
import type {SubagentResult} from '@/subagents/types.js';
import type {ChangedLines} from './citation-validate.js';
import {changedLinesFromDiff, validateCitations} from './citation-validate.js';
import {
	applyVerdicts,
	formatFinding,
	parseFindings,
	parseVerdicts,
	type ReviewFinding,
	type ReviewVerdict,
} from './finding-format.js';
import {
	REVIEW_FINDER_AGENT,
	REVIEW_READ_ONLY_TOOLS,
	REVIEW_VERIFIER_AGENT,
	registerReviewAgents,
} from './review-agents.js';

/**
 * Tool calls the finder may attempt. Real-world diffs need several reads
 * (each changed file, plus surrounding callers); reasoning models also
 * spend turns thinking before their first tool call.
 */
const DEFAULT_FINDER_MAX_TOOL_CALLS = 24;
/** Model turns for the finder, including its tool-loop turns. */
const DEFAULT_FINDER_MAX_TURNS = 16;
/** Tool calls a single verifier run may attempt. One file read usually suffices. */
const DEFAULT_VERIFIER_MAX_TOOL_CALLS = 4;
/** Model turns for a single verifier run. */
const DEFAULT_VERIFIER_MAX_TURNS = 4;
/** Findings that get a verifier. The rest are reported as unverified. */
const DEFAULT_MAX_VERIFIED_FINDINGS = 10;

/**
 * The part of SubagentExecutor this pipeline needs. Narrowed to an interface
 * so tests can drive the pipeline without an executor or a provider.
 */
export interface ReviewSubagentExecutor {
	execute(
		task: {
			subagent_type: string;
			description: string;
			prompt?: string;
		},
		signal?: AbortSignal,
		depth?: number,
		agentId?: string,
		executionContext?: unknown,
		limits?: SubagentExecutionLimits,
	): Promise<SubagentResult>;
}

export interface DefaultReviewOptions {
	/** The unified diff under review. */
	diff: string;
	/** Human-readable target description, e.g. `main...feature`. */
	targetDescription: string;
	/**
	 * Project root for citation validation. Defaults to process.cwd(); tests
	 * point it at a temporary project directory.
	 */
	projectRoot?: string;
	signal?: AbortSignal;
	finderMaxToolCalls?: number;
	finderMaxTurns?: number;
	verifierMaxToolCalls?: number;
	verifierMaxTurns?: number;
	maxVerifiedFindings?: number;
	/** Loader for built-in agent registration. Skipped when omitted. */
	loader?: SubagentLoader;
}

export interface DroppedFinding {
	finding: ReviewFinding;
	verdict: ReviewVerdict | 'UNVERIFIED';
	reason: string;
}

export interface DefaultReviewResult {
	confirmed: ReviewFinding[];
	dropped: DroppedFinding[];
	/** Notes for the report: skips, failures, and caveats. Order matters. */
	notes: string[];
	/** Approximate streamed token counts per phase, not billing usage. */
	usage: {finder: number; verifier: number};
}

const readOnlyCeiling: string[] = [...REVIEW_READ_ONLY_TOOLS];

function countTokens(result: SubagentResult | undefined): number {
	return result?.tokensUsed ?? 0;
}

/**
 * Run the default review tier. Returns confirmed findings, everything that
 * was dropped and why, and human-readable notes. Model failures become
 * notes and partial results rather than thrown errors.
 */
export async function runDefaultReview(
	executor: ReviewSubagentExecutor,
	options: DefaultReviewOptions,
): Promise<DefaultReviewResult> {
	const notes: string[] = [];
	const usage = {finder: 0, verifier: 0};

	if (options.loader) {
		await registerReviewAgents(options.loader);
	}

	const finderLimits: SubagentExecutionLimits = {
		allowedTools: readOnlyCeiling,
		maxToolCalls: options.finderMaxToolCalls ?? DEFAULT_FINDER_MAX_TOOL_CALLS,
		maxTurns: options.finderMaxTurns ?? DEFAULT_FINDER_MAX_TURNS,
	};

	const finderRun = await executor.execute(
		{
			subagent_type: REVIEW_FINDER_AGENT,
			description: `Review changes for ${options.targetDescription}`,
			prompt: [
				// Reasoning models (nemotron-ultra et al.) will otherwise
				// investigate forever: stating the budget in the prompt makes
				// them converge to a final FINDING/no-issues answer.
				'IMPORTANT: You have a hard budget of at most 24 tool calls.',
				'Once you have enough evidence — or reach the budget — stop',
				'investigating and output your FINDING blocks as your final',
				'message. A reasoned "no issues" answer is acceptable.',
				'',
				'Review the following diff. Investigate the real code with your',
				'tools before reporting. Output FINDING blocks only, no commentary.',
				'',
				'```diff',
				options.diff,
				'```',
			].join('\n'),
		},
		options.signal,
		0,
		undefined,
		undefined,
		finderLimits,
	);
	usage.finder = countTokens(finderRun);

	if (!finderRun.success) {
		notes.push(
			`finder did not complete cleanly: ${finderRun.error ?? 'unknown error'}`,
		);
	}

	const parsed = parseFindings(finderRun.output);
	for (const block of parsed.discarded) {
		notes.push(`discarded malformed finding block: ${block}`);
	}
	if (parsed.findings.length === 0) {
		if (finderRun.success) {
			if (parsed.unparseable && finderRun.output.trim()) {
				notes.push('finder output was not in FINDING format');
			}
			notes.push('finder reported no issues');
		}
		return {confirmed: [], dropped: [], notes, usage};
	}

	// Deterministic citation gate: never spend a verifier on a finding whose
	// citation does not point at real changed code.
	const changed: ChangedLines = changedLinesFromDiff(options.diff);
	const validation = validateCitations(
		options.projectRoot ?? process.cwd(),
		parsed.findings,
		changed,
	);
	const rejectedIds = new Set<string>();
	for (const bad of validation.invalid) {
		const finding = parsed.findings.find(
			f => f.file === bad.file && f.line === bad.line,
		);
		if (finding) {
			rejectedIds.add(finding.id);
			notes.push(`citation rejected for ${finding.id}: ${bad.reason}`);
		}
	}

	const toVerify = parsed.findings.filter(f => !rejectedIds.has(f.id));
	const cap = Math.max(
		0,
		options.maxVerifiedFindings ?? DEFAULT_MAX_VERIFIED_FINDINGS,
	);
	const verifiable = toVerify.slice(0, cap);
	const overCap = toVerify.slice(cap);

	const dropped: DroppedFinding[] = [
		...parsed.findings
			.filter(f => rejectedIds.has(f.id))
			.map(finding => ({
				finding,
				verdict: 'UNVERIFIED' as const,
				reason: 'citation rejected',
			})),
		...overCap.map(finding => ({
			finding,
			verdict: 'UNVERIFIED' as const,
			reason: `verification cap (${cap}) reached`,
		})),
	];

	if (verifiable.length === 0) {
		return {confirmed: [], dropped, notes, usage};
	}

	const verdicts = [];
	for (const finding of verifiable) {
		if (options.signal?.aborted) {
			notes.push('cancelled before verifying remaining findings');
			dropped.push({finding, verdict: 'UNVERIFIED', reason: 'cancelled'});
			continue;
		}

		const verifierRun = await executor.execute(
			{
				subagent_type: REVIEW_VERIFIER_AGENT,
				description: `Verify finding ${finding.id}`,
				prompt: [
					`Review target: ${options.targetDescription}`,
					'',
					'The diff under review:',
					'```diff',
					options.diff,
					'```',
					'',
					'The finding to verify:',
					formatFinding(finding),
				].join('\n'),
			},
			options.signal,
			0,
			undefined,
			undefined,
			{
				allowedTools: readOnlyCeiling,
				maxToolCalls:
					options.verifierMaxToolCalls ?? DEFAULT_VERIFIER_MAX_TOOL_CALLS,
				maxTurns: options.verifierMaxTurns ?? DEFAULT_VERIFIER_MAX_TURNS,
			},
		);
		usage.verifier += countTokens(verifierRun);

		if (!verifierRun.success) {
			notes.push(
				`verifier for ${finding.id} did not complete cleanly: ${
					verifierRun.error ?? 'unknown error'
				}`,
			);
		}

		const parsedVerdicts = parseVerdicts(verifierRun.output);
		verdicts.push(...parsedVerdicts.verdicts);
	}

	const applied = applyVerdicts(verifiable, verdicts);
	return {
		confirmed: applied.confirmed,
		dropped: [...dropped, ...applied.dropped],
		notes,
		usage,
	};
}

// ============================================================================
// Deep tier: multiple specialist finders, dedup, one shared verification pass.
//

/**
 * One finder perspective. `lens` is appended to the finder prompt so each
 * run looks for a different class of issue; `label` appears in notes.
 */
export interface FinderLens {
	id: string;
	label: string;
	lens: string;
}

export const FINDER_LENSES: FinderLens[] = [
	{
		id: 'bugs',
		label: 'bugs',
		lens: 'Focus on correctness bugs: logic errors, broken edge cases, race conditions, error-handling gaps, and security vulnerabilities.',
	},
	{
		id: 'standards',
		label: 'standards and API misuse',
		lens: 'Focus on standards and API misuse: deprecated or misused APIs, type-safety violations, resource leaks, missing cleanup, and violations of patterns the surrounding code follows.',
	},
	{
		id: 'spec',
		label: 'intent and spec',
		lens: 'Focus on intent: does the change do what it claims, are there implicit behaviours or callers the change breaks, and are there missing pieces (unused parameters, dead code paths, incomplete migrations) that suggest the change is unfinished?',
	},
];

/** A finding produced by one finder run, before dedup. */
interface SourcedFinding {
	finding: ReviewFinding;
	lens: string;
}

/**
 * Deduplicate findings across finders. Two findings collapse when they cite
 * the same file and line and their issues are textually similar (case- and
 * whitespace-insensitive substring match in either direction). The first
 * lens to report wins; later duplicates are recorded for the report.
 */
export function dedupeFindings(sourced: SourcedFinding[]): {
	unique: SourcedFinding[];
	duplicates: Array<{kept: string; dropped: string}>;
} {
	const unique: SourcedFinding[] = [];
	const duplicates: Array<{kept: string; dropped: string}> = [];

	const normalise = (text: string) =>
		text
			.toLowerCase()
			.replaceAll(/[^a-z0-9]+/g, ' ')
			.trim();
	const similar = (a: string, b: string) => {
		const na = normalise(a);
		const nb = normalise(b);
		return na.includes(nb) || nb.includes(na);
	};

	for (const candidate of sourced) {
		const match = unique.find(
			u =>
				u.finding.file === candidate.finding.file &&
				u.finding.line === candidate.finding.line &&
				similar(u.finding.issue, candidate.finding.issue),
		);
		if (match) {
			duplicates.push({kept: match.lens, dropped: candidate.lens});
		} else {
			unique.push(candidate);
		}
	}

	return {unique, duplicates};
}

/**
 * Re-ID findings after dedup so verifier prompts and reports use one
 * consistent numbering across all finders.
 */
function renumber(sourced: SourcedFinding[]): SourcedFinding[] {
	return sourced.map((entry, index) => ({
		...entry,
		finding: {...entry.finding, id: `F${index + 1}`},
	}));
}

/**
 * Run the deep review tier: several specialist finders investigate the same
 * diff, their findings are deduplicated, then every survivor is verified by
 * an independent verifier exactly as in the default tier. Finder runs are
 * sequential and individually budgeted.
 */
export async function runDeepReview(
	executor: ReviewSubagentExecutor,
	options: DefaultReviewOptions & {
		finderMaxToolCalls?: number;
		finderMaxTurns?: number;
	},
): Promise<DefaultReviewResult> {
	const notes: string[] = [];
	const usage = {finder: 0, verifier: 0};

	if (options.loader) {
		await registerReviewAgents(options.loader);
	}

	const sourced: SourcedFinding[] = [];
	for (const lens of FINDER_LENSES) {
		if (options.signal?.aborted) {
			notes.push('cancelled before running all finders');
			break;
		}

		const finderRun = await executor.execute(
			{
				subagent_type: REVIEW_FINDER_AGENT,
				description: `Review ${options.targetDescription} (${lens.label})`,
				prompt: [
					`Review focus: ${lens.lens}`,
					'',
					// Same convergence instruction as the default tier's finder:
					// reasoning models otherwise never stop investigating.
					'IMPORTANT: You have a hard budget of at most 24 tool calls.',
					'Once you have enough evidence — or reach the budget — stop',
					'investigating and output your FINDING blocks as your final',
					'message. A reasoned "no issues" answer is acceptable.',
					'',
					'Review the following diff. Investigate the real code with your',
					'tools before reporting. Output FINDING blocks only, no commentary.',
					'',
					'```diff',
					options.diff,
					'```',
				].join('\n'),
			},
			options.signal,
			0,
			undefined,
			undefined,
			{
				allowedTools: readOnlyCeiling,
				maxToolCalls:
					options.finderMaxToolCalls ?? DEFAULT_FINDER_MAX_TOOL_CALLS,
				maxTurns: options.finderMaxTurns ?? DEFAULT_FINDER_MAX_TURNS,
			},
		);
		usage.finder += countTokens(finderRun);

		if (!finderRun.success) {
			notes.push(
				`${lens.label} finder did not complete cleanly: ${
					finderRun.error ?? 'unknown error'
				}`,
			);
		}

		const parsed = parseFindings(finderRun.output);
		for (const block of parsed.discarded) {
			notes.push(`discarded malformed finding block (${lens.label}): ${block}`);
		}
		if (parsed.findings.length === 0 && finderRun.success) {
			notes.push(`${lens.label} finder reported no issues`);
		}
		sourced.push(
			...parsed.findings.map(finding => ({finding, lens: lens.label})),
		);
	}

	if (sourced.length === 0) {
		return {confirmed: [], dropped: [], notes, usage};
	}

	const {unique, duplicates} = dedupeFindings(sourced);
	for (const dup of duplicates) {
		notes.push(
			`duplicate finding reported by ${dup.dropped} already covered by ${dup.kept}`,
		);
	}
	const findings = renumber(unique);

	// From here the deep tier is the default tier's verification pass, with
	// the deduplicated, renumbered finding set.
	const changed: ChangedLines = changedLinesFromDiff(options.diff);
	const validation = validateCitations(
		options.projectRoot ?? process.cwd(),
		findings.map(f => f.finding),
		changed,
	);
	const rejectedIds = new Set(
		validation.invalid.map(bad => {
			const finding = findings.find(
				f => f.finding.file === bad.file && f.finding.line === bad.line,
			);
			return finding?.finding.id ?? '';
		}),
	);
	for (const bad of validation.invalid) {
		notes.push(`citation rejected: ${bad.file}:${bad.line} — ${bad.reason}`);
	}

	const toVerify = findings.filter(f => !rejectedIds.has(f.finding.id));
	const cap = Math.max(
		0,
		options.maxVerifiedFindings ?? DEFAULT_MAX_VERIFIED_FINDINGS,
	);
	const verifiable = toVerify.slice(0, cap);
	const overCap = toVerify.slice(cap);

	const dropped: DroppedFinding[] = [
		...findings
			.filter(f => rejectedIds.has(f.finding.id))
			.map(({finding}) => ({
				finding,
				verdict: 'UNVERIFIED' as const,
				reason: 'citation rejected',
			})),
		...overCap.map(({finding}) => ({
			finding,
			verdict: 'UNVERIFIED' as const,
			reason: `verification cap (${cap}) reached`,
		})),
	];

	if (verifiable.length === 0) {
		return {confirmed: [], dropped, notes, usage};
	}

	const verdicts = [];
	for (const {finding} of verifiable) {
		if (options.signal?.aborted) {
			notes.push('cancelled before verifying remaining findings');
			dropped.push({finding, verdict: 'UNVERIFIED', reason: 'cancelled'});
			continue;
		}

		const verifierRun = await executor.execute(
			{
				subagent_type: REVIEW_VERIFIER_AGENT,
				description: `Verify finding ${finding.id}`,
				prompt: [
					`Review target: ${options.targetDescription}`,
					'',
					'The diff under review:',
					'```diff',
					options.diff,
					'```',
					'',
					'The finding to verify:',
					formatFinding(finding),
				].join('\n'),
			},
			options.signal,
			0,
			undefined,
			undefined,
			{
				allowedTools: readOnlyCeiling,
				maxToolCalls:
					options.verifierMaxToolCalls ?? DEFAULT_VERIFIER_MAX_TOOL_CALLS,
				maxTurns: options.verifierMaxTurns ?? DEFAULT_VERIFIER_MAX_TURNS,
			},
		);
		usage.verifier += countTokens(verifierRun);

		if (!verifierRun.success) {
			notes.push(
				`verifier for ${finding.id} did not complete cleanly: ${
					verifierRun.error ?? 'unknown error'
				}`,
			);
		}

		const parsedVerdicts = parseVerdicts(verifierRun.output);
		verdicts.push(...parsedVerdicts.verdicts);
	}

	const applied = applyVerdicts(
		verifiable.map(f => f.finding),
		verdicts,
	);
	return {
		confirmed: applied.confirmed,
		dropped: [...dropped, ...applied.dropped],
		notes,
		usage,
	};
}
