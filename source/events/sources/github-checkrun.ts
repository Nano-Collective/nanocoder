/**
 * CI check-run event source for the skill event router.
 *
 * Polls `gh run list` for the most recent *completed* GitHub Actions run on
 * a branch (defaulting to whatever branch is currently checked out, so it
 * tracks the developer switching branches on a long-running daemon). When
 * that run's conclusion is `failure` and it hasn't been seen before, it
 * emits a `ci.job.failed` event and calls the optional `onDetected` hook
 * first, so a caller can fire an OS notification before the (potentially
 * slow) investigation dispatch that follows from `router.emit()` resolving.
 *
 * On a `gh` error or unparseable output (rate limit, network, a CLI banner
 * on stdout) the poll interval grows via `ExponentialBackoff` instead of
 * hammering the API; a poll that both succeeds and parses resets it. Dedup
 * (`lastSeenRunId`) is in-memory only and does not survive a daemon restart
 * — an accepted limitation, consistent with subscriptions themselves not
 * being persisted either. A single scalar is enough (rather than a set of
 * every run id ever seen) because `--limit 1` only ever returns the single
 * latest run, and GitHub run ids are unique across the whole repo.
 *
 * Modeled structurally on `ScheduleEventSource`: injectable dependencies for
 * testability, `start()`/`stop()` lifecycle, emits into the shared
 * `EventRouter` and otherwise knows nothing about subagents, formatting, or
 * notifications.
 */

import type {EventRouter} from '@/events/event-router';
import type {CiJobFailedPayload} from '@/events/types';
import {execGh, getCurrentBranch} from '@/tools/git/utils';
import {ExponentialBackoff} from '@/utils/backoff';

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_MAX_POLL_INTERVAL_MS = 300_000;

interface RunListEntry {
	databaseId: number;
	conclusion: string | null;
	headSha: string;
	workflowName: string;
	url: string;
	headBranch: string;
}

export interface CiEventSourceOptions {
	/** Fixed branch to poll. Defaults to resolving the current branch on every poll. */
	branch?: string;
	pollIntervalMs?: number;
	maxPollIntervalMs?: number;
	/** Fired right before `router.emit()`, so detection can notify before dispatch finishes. */
	onDetected?: (payload: CiJobFailedPayload) => void;
	execGhFn?: typeof execGh;
	getCurrentBranchFn?: typeof getCurrentBranch;
	now?: () => number;
	scheduleFn?: (fn: () => void, ms: number) => NodeJS.Timeout;
	clearFn?: (handle: NodeJS.Timeout) => void;
}

export class CiEventSource {
	private lastSeenRunId: number | null = null;
	private readonly backoff: ExponentialBackoff;
	private readonly execGhFn: typeof execGh;
	private readonly getCurrentBranchFn: typeof getCurrentBranch;
	private readonly now: () => number;
	private readonly scheduleFn: (fn: () => void, ms: number) => NodeJS.Timeout;
	private readonly clearFn: (handle: NodeJS.Timeout) => void;
	private readonly pollIntervalMs: number;

	private timer: NodeJS.Timeout | null = null;
	private started = false;
	private stopped = false;

	constructor(
		private readonly router: EventRouter,
		private readonly options: CiEventSourceOptions = {},
	) {
		this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		this.backoff = new ExponentialBackoff({
			baseMs: this.pollIntervalMs,
			maxMs: options.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS,
		});
		this.execGhFn = options.execGhFn ?? execGh;
		this.getCurrentBranchFn = options.getCurrentBranchFn ?? getCurrentBranch;
		this.now = options.now ?? Date.now;
		this.scheduleFn = options.scheduleFn ?? ((fn, ms) => setTimeout(fn, ms));
		this.clearFn = options.clearFn ?? clearTimeout;
	}

	/** Idempotent. Polls immediately, then schedules subsequent polls. */
	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		this.stopped = false;
		await this.pollOnce();
	}

	/** Idempotent. Cancels any pending poll. */
	stop(): void {
		this.stopped = true;
		this.started = false;
		if (this.timer) {
			this.clearFn(this.timer);
			this.timer = null;
		}
	}

	private scheduleNext(delayMs: number): void {
		if (this.stopped) return;
		this.timer = this.scheduleFn(() => {
			void this.pollOnce();
		}, delayMs);
	}

	private async pollOnce(): Promise<void> {
		const branch = this.options.branch ?? (await this.getCurrentBranchFn());

		let raw: string;
		try {
			raw = await this.execGhFn([
				'run',
				'list',
				'--branch',
				branch,
				'--status',
				'completed',
				'--limit',
				'1',
				'--json',
				'databaseId,conclusion,headSha,workflowName,url,headBranch',
			]);
		} catch {
			this.scheduleNext(this.backoff.next());
			return;
		}

		let runs: RunListEntry[];
		try {
			runs = JSON.parse(raw) as RunListEntry[];
		} catch {
			// Treat unparseable output (a CLI update banner, truncated stdout)
			// the same as a `gh` exec failure: back off instead of retrying at
			// the fixed interval, since a real backoff.reset() already fired on
			// the *previous* success and we don't want to hammer a source that
			// keeps returning garbage.
			this.scheduleNext(this.backoff.next());
			return;
		}

		this.backoff.reset();

		const run = runs[0];
		if (
			run &&
			run.conclusion === 'failure' &&
			run.databaseId !== this.lastSeenRunId
		) {
			this.lastSeenRunId = run.databaseId;
			const payload: CiJobFailedPayload = {
				runId: run.databaseId,
				workflowName: run.workflowName,
				branch: run.headBranch,
				headSha: run.headSha,
				url: run.url,
			};
			this.options.onDetected?.(payload);
			await this.router.emit({kind: 'ci.job.failed', payload, at: this.now()});
		}

		this.scheduleNext(this.pollIntervalMs);
	}
}
