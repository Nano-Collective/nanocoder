/**
 * Non-TTY `nanocoder review`.
 *
 * Runs the same grounded, deep, and quick tiers as the TUI without Ink.
 * The report (markdown, or JSON with --output-format json) is the only
 * thing written to stdout. Progress and errors go to stderr.
 */

import path from 'node:path';
import {createReviewView, type ReviewDependencies} from '@/commands/review';
import {getAppConfig} from '@/config/index';
import {loadPreferences, savePreferences} from '@/config/preferences';
import {
	ensureDirectoryTrust,
	untrustedDirectoryMessage,
} from '@/config/trust/directory-trust';
import {resolveTune} from '@/config/tune';
import {initializePlain} from '@/plain/initialize';
import {writeError, writeStatus} from '@/plain/writer';
import type {TuneConfig} from '@/types/config';
import type {LLMClient} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {getShutdownManager} from '@/utils/shutdown';
import {ReviewActivityStore} from './review-activity';
import {renderGroundedReviewReport} from './review-report';
import {resolveReviewToolMode} from './review-tool-mode';
import type {ReviewFoundationTools} from './review-tools';
import {runDeepReview} from './run-deep-review';
import {
	type GroundedReviewResult,
	type GroundedReviewStatus,
	runGroundedReview,
} from './run-grounded-review';

export type HeadlessReviewTier = 'grounded' | 'deep' | 'quick';

export interface HeadlessReviewJson {
	tier: HeadlessReviewTier;
	status: GroundedReviewStatus | 'completed' | 'failed';
	scope?: string;
	message?: string;
	text?: string;
	findings: GroundedReviewResult['findings'];
	dropped: GroundedReviewResult['dropped'];
	unverified: GroundedReviewResult['unverified'];
	incompleteReasons: string[];
	notes: string[];
	stats: GroundedReviewResult['stats'];
	reviewId?: string;
}

export interface HeadlessReviewOptions {
	/** Words after `review` (`deep`, `quick`, and the target). */
	args: string[];
	client: LLMClient;
	provider: string;
	model: string;
	tune?: TuneConfig;
	outputFormat?: 'text' | 'json';
	tools?: ReviewFoundationTools;
	/** Git and prompt seams for the one-shot tier. */
	quickDependencies?: ReviewDependencies;
	signal?: AbortSignal;
	/** Status lines. Defaults to stderr. */
	writeProgress?: (line: string) => void;
}

const TIER_WORDS = new Set(['quick', 'deep']);

export function splitHeadlessReviewArgs(args: string[]): {
	tier: HeadlessReviewTier;
	request: string;
} {
	const [first, ...rest] = args;
	if (first && TIER_WORDS.has(first.toLowerCase())) {
		return {
			tier: first.toLowerCase() === 'deep' ? 'deep' : 'quick',
			request: rest.join(' ').trim(),
		};
	}
	return {tier: 'grounded', request: args.join(' ').trim()};
}

export function buildHeadlessReviewJson(
	result: GroundedReviewResult,
	tier: Exclude<HeadlessReviewTier, 'quick'>,
): HeadlessReviewJson {
	return {
		tier,
		status: result.status,
		...(result.scope ? {scope: result.scope} : {}),
		...(result.message ? {message: result.message} : {}),
		findings: result.findings,
		dropped: result.dropped,
		unverified: result.unverified,
		incompleteReasons: result.incompleteReasons,
		notes: result.notes,
		stats: result.stats,
		reviewId: result.reviewId,
	};
}

function failureJson(tier: HeadlessReviewTier, message: string): string {
	const body: HeadlessReviewJson = {
		tier,
		status: 'failed',
		message,
		findings: [],
		dropped: [],
		unverified: [],
		incompleteReasons: [],
		notes: [],
		stats: {reported: 0, verifierRuns: 0, modelCalls: 0, toolCalls: 0},
	};
	return `${JSON.stringify(body, null, 2)}\n`;
}

/**
 * 0 for a completed review or an empty scope, 2 for an incomplete one
 * (partial coverage, so a CI gate cannot read it as a clean pass), 1 when no
 * review was produced.
 */
function exitCodeFor(status: GroundedReviewStatus): number {
	if (status === 'completed' || status === 'empty') return 0;
	if (status === 'incomplete') return 2;
	return 1;
}

function watchProgress(
	activity: ReviewActivityStore,
	writeProgress: (line: string) => void,
): () => void {
	let previous = '';
	return activity.subscribe(() => {
		const summary = activity.toSummary();
		const latest = summary.events.at(-1);
		const line = latest
			? `${latest.source}: ${latest.name}: ${latest.updates.at(-1)?.summary ?? latest.status}`
			: `review: ${summary.status}`;
		if (line === previous) return;
		previous = line;
		writeProgress(line);
	});
}

type RenderedNode = {
	props?: {message?: unknown; children?: unknown};
	type?: {name?: string};
};

// The quick tier returns either one message element or a fragment of
// messages (scope notice, coverage warning, reasoning, then the report).
function collectMessages(
	node: unknown,
): Array<{text: string; component: string}> {
	if (Array.isArray(node)) return node.flatMap(collectMessages);
	if (!node || typeof node !== 'object' || !('props' in node)) return [];
	const {props, type} = node as RenderedNode;
	if (typeof props?.message === 'string') {
		return [{text: props.message, component: type?.name ?? ''}];
	}
	return collectMessages(props?.children);
}

function componentMessage(node: unknown): {text: string; failed: boolean} {
	const messages = collectMessages(node);
	if (messages.length === 0) return {text: 'Review failed.', failed: true};
	return {
		text: messages.map(message => message.text).join('\n\n'),
		failed: messages.some(message => message.component === 'ErrorMessage'),
	};
}

/**
 * Run one review without the TUI. Stdout receives only the finished report.
 */
export async function runHeadlessReview(
	options: HeadlessReviewOptions,
): Promise<{exitCode: number; stdout: string}> {
	const writeProgress = options.writeProgress ?? writeStatus;
	const {tier, request} = splitHeadlessReviewArgs(options.args);
	const format = options.outputFormat ?? 'text';

	if (tier === 'quick') {
		writeProgress('Running the one-shot review');
		const command = createReviewView(options.quickDependencies);
		const rendered = await command.handler(
			['quick', ...request.split(/\s+/).filter(Boolean)],
			[],
			{
				provider: options.provider,
				model: options.model,
				tokens: 0,
				getMessageTokens: () => 0,
				client: options.client,
				...(options.tune ? {tune: options.tune} : {}),
			},
		);
		const {text, failed} = componentMessage(rendered);
		if (failed) {
			writeProgress(text);
			return {
				exitCode: 1,
				stdout: format === 'json' ? failureJson('quick', text) : '',
			};
		}
		if (format === 'json') {
			const body: HeadlessReviewJson = {
				tier: 'quick',
				status: 'completed',
				text,
				findings: [],
				dropped: [],
				unverified: [],
				incompleteReasons: [],
				notes: [],
				stats: {reported: 0, verifierRuns: 0, modelCalls: 0, toolCalls: 0},
			};
			return {exitCode: 0, stdout: `${JSON.stringify(body, null, 2)}\n`};
		}
		return {exitCode: 0, stdout: `${text}\n`};
	}

	const activity = new ReviewActivityStore();
	const stopWatching = watchProgress(activity, writeProgress);
	try {
		const run = tier === 'deep' ? runDeepReview : runGroundedReview;
		const result = await run({
			request,
			client: options.client,
			toolMode: resolveReviewToolMode(
				options.provider,
				options.model,
				options.tune,
			),
			activity,
			...(options.tools ? {tools: options.tools} : {}),
			...(options.signal ? {signal: options.signal} : {}),
		});
		writeProgress(`review: ${result.status}`);
		if (format === 'json') {
			return {
				exitCode: exitCodeFor(result.status),
				stdout: `${JSON.stringify(buildHeadlessReviewJson(result, tier), null, 2)}\n`,
			};
		}
		const report = renderGroundedReviewReport(
			result,
			tier === 'deep' ? 'Deep' : 'Grounded',
		);
		return {exitCode: exitCodeFor(result.status), stdout: `${report}\n`};
	} finally {
		stopWatching();
	}
}

export interface HeadlessReviewCliOptions {
	/** Words after `review` (`deep`, `quick`, and the target). */
	args: string[];
	cliProvider?: string;
	cliModel?: string;
	trustDirectory: boolean;
	outputFormat: 'text' | 'json';
	signal?: AbortSignal;
	deps?: Partial<HeadlessReviewCliDeps>;
}

export interface HeadlessReviewCliDeps {
	initializePlain: typeof initializePlain;
	runHeadlessReview: typeof runHeadlessReview;
	loadPreferences: typeof loadPreferences;
	savePreferences: typeof savePreferences;
	getAppConfig: typeof getAppConfig;
	getShutdownManager: () => Pick<
		ReturnType<typeof getShutdownManager>,
		'register' | 'unregister'
	>;
	writeError: (line: string) => void;
	writeStdout: (text: string) => Promise<void>;
}

function writeStdout(text: string): Promise<void> {
	// process.exit() can discard buffered output when stdout is piped.
	return new Promise(resolve =>
		process.stdout.write(text, 'utf8', () => resolve()),
	);
}

const defaultCliDeps: HeadlessReviewCliDeps = {
	initializePlain,
	runHeadlessReview,
	loadPreferences,
	savePreferences,
	getAppConfig,
	getShutdownManager,
	writeError,
	writeStdout,
};

const SHUTDOWN_HANDLER = 'headless-review-report';

/**
 * `nanocoder review` without a TTY: the same trust gate as `nanocoder run`,
 * then provider setup and the review. Setup failures still produce a JSON
 * document when JSON was requested. The report is written to stdout before
 * this resolves; the caller only has to exit with `exitCode`.
 */
export async function runHeadlessReviewCli(
	options: HeadlessReviewCliOptions,
): Promise<{exitCode: number; stdout: string}> {
	const deps: HeadlessReviewCliDeps = {...defaultCliDeps, ...options.deps};
	// Ctrl+C also starts the shutdown manager's own exit (code 0). Its handler
	// waits here until the cancelled review's report is on stdout, and the
	// caller's exit with the review's code then overrides that 0.
	let markReported: () => void = () => undefined;
	const reported = new Promise<void>(resolve => {
		markReported = resolve;
	});
	const abortController = new AbortController();
	const shutdown = deps.getShutdownManager();
	shutdown.register({
		name: SHUTDOWN_HANDLER,
		priority: 10,
		handler: async () => {
			abortController.abort();
			await reported;
		},
	});
	try {
		const outcome = await reviewWithoutTui(options, deps, abortController);
		await deps.writeStdout(outcome.stdout);
		return outcome;
	} finally {
		markReported();
		shutdown.unregister(SHUTDOWN_HANDLER);
	}
}

async function reviewWithoutTui(
	options: HeadlessReviewCliOptions,
	deps: HeadlessReviewCliDeps,
	abortController: AbortController,
): Promise<{exitCode: number; stdout: string}> {
	const {tier} = splitHeadlessReviewArgs(options.args);
	const fail = (message: string) => {
		deps.writeError(message);
		return {
			exitCode: 1,
			stdout: options.outputFormat === 'json' ? failureJson(tier, message) : '',
		};
	};

	const trust = ensureDirectoryTrust(process.cwd(), options.trustDirectory, {
		loadPreferences: deps.loadPreferences,
		savePreferences: deps.savePreferences,
	});
	if (trust.persisted) {
		writeStatus(
			`Marked ${path.resolve(process.cwd())} as trusted (NANOCODER_TRUST_DIRECTORY=1).`,
		);
	}
	if (!trust.trusted) {
		return fail(
			untrustedDirectoryMessage(path.resolve(process.cwd()), trust.recheck),
		);
	}

	// Ctrl+C cancels the review, so the report still says what was covered.
	const sigint = () => abortController.abort();
	const signal = options.signal ?? abortController.signal;
	if (!options.signal) process.on('SIGINT', sigint);
	try {
		const init = await deps.initializePlain({
			...(options.cliProvider ? {cliProvider: options.cliProvider} : {}),
			...(options.cliModel ? {cliModel: options.cliModel} : {}),
		});
		const tune = resolveTune(
			deps.getAppConfig(),
			init.client.getProviderConfig(),
			deps.loadPreferences(),
		);
		return await deps.runHeadlessReview({
			args: options.args,
			client: init.client,
			provider: init.provider,
			model: init.model,
			tune,
			outputFormat: options.outputFormat,
			signal,
		});
	} catch (error) {
		return fail(formatError(error));
	} finally {
		process.off('SIGINT', sigint);
	}
}
