/**
 * Headless `nanocoder review` runner.
 *
 * The interactive TUI renders the review report as chat components; this
 * module runs the same review tiers without Ink so `nanocoder review` works
 * in a plain shell (piped, redirected, CI). Output goes to stdout as either
 * the markdown report or a JSON document; all status traffic stays on
 * stderr, leaving stdout clean for redirection.
 */

import {parseReviewArgs} from '@/commands/review-tier.js';
import {writeStatus} from '@/plain/writer';
import {renderReviewReport} from '@/review/review-report.js';
import {
	type DefaultReviewResult,
	runDeepReview,
	runDefaultReview,
} from '@/review/run-default-review.js';
import {getProjectRoot} from '@/services/session-cwd';
import {getSubagentLoader} from '@/subagents/subagent-loader.js';
import {getAgentToolExecutor} from '@/tools/agent-tool';
import {truncateDiff} from '@/tools/git/utils';
import type {LLMClient} from '@/types/index';
import {loadSection} from '@/utils/prompt-builder';

export interface HeadlessReviewOptions {
	/** Args after `review` on the command line (tier word + target). */
	args: string[];
	client: LLMClient;
	/** Resolves the diff and human-readable target for the review. */
	resolveDiff: () => Promise<{
		ok: boolean;
		diff?: string;
		targetDescription?: string;
		error?: string;
	}>;
}

export interface ReviewJsonReport {
	tier: 'default' | 'deep';
	target: string;
	confirmed: Array<{
		id: string;
		file: string;
		line: number;
		severity: string;
		issue: string;
		evidence: string;
	}>;
	dropped: Array<{
		id: string;
		file: string;
		line: number;
		verdict: string;
		reason: string;
	}>;
	notes: string[];
	usage: {finder: number; verifier: number};
}

/** Build the JSON document for one review result. */
export function buildReviewJsonReport(
	result: DefaultReviewResult,
	tier: 'default' | 'deep',
	target: string,
): ReviewJsonReport {
	return {
		tier,
		target,
		confirmed: result.confirmed.map(f => ({
			id: f.id,
			file: f.file,
			line: f.line,
			severity: f.severity,
			issue: f.issue,
			evidence: f.evidence,
		})),
		dropped: result.dropped.map(d => ({
			id: d.finding.id,
			file: d.finding.file,
			line: d.finding.line,
			verdict: d.verdict,
			reason: d.reason,
		})),
		notes: result.notes,
		usage: result.usage,
	};
}

const FALLBACK_REVIEW_PROMPT =
	'You are a senior software engineer performing a code review. Review the diff for bugs, security issues, and style violations. Be concise and actionable.';

/** The quick tier headlessly: the one-shot model pass, no executor. */
async function runHeadlessQuickReview(
	options: HeadlessReviewOptions,
): Promise<{exitCode: number; stdout: string}> {
	const resolved = await options.resolveDiff();
	if (!resolved.ok || !resolved.diff) {
		writeStatus(resolved.error ?? 'Failed to resolve review target.');
		return {exitCode: 1, stdout: ''};
	}

	const truncated = truncateDiff(resolved.diff, 1000);
	if (!truncated.content.trim()) {
		writeStatus(`No changes found in ${resolved.targetDescription}.`);
		return {exitCode: 1, stdout: ''};
	}

	const parts: string[] = [
		`Reviewing changes from ${resolved.targetDescription}:\n`,
	];
	if (truncated.truncated) {
		const halfLines = Math.ceil(1000 / 2);
		parts.push(
			`[Note: diff truncated — reviewed first and last ${halfLines} of ${truncated.totalLines} lines]\n`,
		);
	}
	parts.push(truncated.content);

	const response = await options.client.chat(
		[
			{
				role: 'system',
				content: loadSection('review') ?? FALLBACK_REVIEW_PROMPT,
			},
			{role: 'user', content: parts.join('\n')},
		],
		{},
		{},
	);
	const review = response?.choices?.[0]?.message?.content?.trim();
	if (!review) {
		writeStatus('Model returned an empty review.');
		return {exitCode: 1, stdout: ''};
	}
	return {exitCode: 0, stdout: review};
}

/**
 * Run a review headlessly. The subagent executor must already be wired via
 * setAgentToolExecutor (initializePlain does this). Returns the text for
 * stdout (markdown, or JSON when requested) and a process exit code. Exit 0
 * always means the review ran; findings present does not change the code.
 */
export async function runHeadlessReview(
	options: HeadlessReviewOptions,
	outputFormat: 'text' | 'json' = 'text',
): Promise<{exitCode: number; stdout: string}> {
	const parsed = parseReviewArgs(options.args);
	if (parsed.tier === 'quick') {
		return runHeadlessQuickReview(options);
	}

	const executor = getAgentToolExecutor();
	if (!executor) {
		writeStatus('Review requires an initialized session; no executor found.');
		return {exitCode: 1, stdout: ''};
	}

	const resolved = await options.resolveDiff();
	if (!resolved.ok || !resolved.diff) {
		writeStatus(resolved.error ?? 'Failed to resolve review target.');
		return {exitCode: 1, stdout: ''};
	}

	const reviewOptions = {
		diff: resolved.diff,
		targetDescription: resolved.targetDescription ?? 'target',
		projectRoot: getProjectRoot(),
		loader: getSubagentLoader(),
	};

	const result =
		parsed.tier === 'deep'
			? await runDeepReview(executor, reviewOptions)
			: await runDefaultReview(executor, reviewOptions);

	const tier = parsed.tier === 'deep' ? 'deep' : 'default';
	const target = resolved.targetDescription ?? 'target';

	if (outputFormat === 'json') {
		return {
			exitCode: 0,
			stdout: `${JSON.stringify(buildReviewJsonReport(result, tier, target), null, 2)}\n`,
		};
	}

	return {exitCode: 0, stdout: renderReviewReport(result, target)};
}
