/**
 * CI check-run event source for the skill event router.
 *
 * Polls `gh run list` for the most recently *completed* GitHub Actions runs
 * on a branch (defaulting to whatever branch is currently checked out, so it
 * tracks the developer switching branches on a long-running daemon), then
 * looks only at the single latest run *per workflow* within that window
 * (fetching more than one run guards against a second workflow completing
 * between polls and pushing an earlier failure out of "the latest run" —
 * see `RUN_LIST_LIMIT`). A workflow whose latest run's conclusion counts as
 * a failure (`failure`, `timed_out`, `startup_failure`) and hasn't been seen
 * before emits a `ci.job.failed` event, calling the optional `onDetected`
 * hook first so a caller can fire an OS notification before the
 * (potentially slow) investigation dispatch that follows from
 * `router.emit()` resolving. Grouping by workflow (rather than emitting for
 * every failing run in the fetch window) matters most on a fresh
 * activation: it reports "which workflows are currently red," not a
 * backlog of every stale failure in that workflow's recent history.
 * Filtering by a specific workflow name is not supported — there's no config
 * surface naming which workflow(s) to watch; `ciWatch.workflows?:
 * string[]` would be a natural follow-up.
 *
 * On a `gh` error or unparseable output (rate limit, network, a CLI banner
 * on stdout) the poll interval grows via `ExponentialBackoff` instead of
 * hammering the API; a poll that both succeeds and parses resets it. Dedup
 * (`seenFailedRunIds`) is capped at `MAX_TRACKED_RUN_IDS` and, by default,
 * in-memory only. A caller that wants dedup to survive a daemon restart can
 * seed `initialSeenFailedRunIds` from its own persisted state and observe
 * `onSeenFailedRunIdsChanged` to keep that state up to date — this class
 * itself does no filesystem I/O.
 *
 * Modeled structurally on `ScheduleEventSource`: injectable dependencies for
 * testability, `start()`/`stop()` lifecycle, emits into the shared
 * `EventRouter` and otherwise knows nothing about subagents, formatting, or
 * notifications.
 */

import {TIMEOUT_GH_METADATA_MS} from '@/constants';
import type {EventRouter} from '@/events/event-router';
import type {CiJobFailedPayload} from '@/events/types';
import {execGh, getCurrentBranch} from '@/tools/git/utils';
import {ExponentialBackoff} from '@/utils/backoff';
import {formatError} from '@/utils/error-formatter';

const DEFAULT_POLL_INTERVAL_MS = 30_000;
/** Floor for a configured `pollIntervalMs`: each poll is a `gh` API call,
 * and a tiny value (say 10) would burn through the rate limit. */
export const MIN_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_INTERVAL_MS = 300_000;
const RUN_LIST_LIMIT = 10;
const MAX_TRACKED_RUN_IDS = 50;
const FAILING_CONCLUSIONS = new Set([
	'failure',
	'timed_out',
	'startup_failure',
]);

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
	/** Seeds dedup state, e.g. from a caller's persisted last-seen run ids. */
	initialSeenFailedRunIds?: number[];
	/** Fired synchronously after `seenFailedRunIds` changes, so a caller can persist it. */
	onSeenFailedRunIdsChanged?: (ids: number[]) => void;
	execGhFn?: typeof execGh;
	getCurrentBranchFn?: typeof getCurrentBranch;
	now?: () => number;
	scheduleFn?: (fn: () => void, ms: number) => NodeJS.Timeout;
	clearFn?: (handle: NodeJS.Timeout) => void;
}

export class CiEventSource {
	private seenFailedRunIds: number[];
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
		this.seenFailedRunIds = [...(options.initialSeenFailedRunIds ?? [])];
		this.pollIntervalMs = Math.max(
			MIN_POLL_INTERVAL_MS,
			options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
		);
		this.backoff = new ExponentialBackoff({
			baseMs: this.pollIntervalMs,
			maxMs: Math.max(
				this.pollIntervalMs,
				options.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS,
			),
		});
		this.execGhFn = options.execGhFn ?? execGh;
		this.getCurrentBranchFn = options.getCurrentBranchFn ?? getCurrentBranch;
		this.now = options.now ?? Date.now;
		this.scheduleFn = options.scheduleFn ?? ((fn, ms) => setTimeout(fn, ms));
		this.clearFn = options.clearFn ?? clearTimeout;
	}

	/**
	 * Idempotent. Schedules the first poll for 0ms rather than awaiting it
	 * inline, so a caller awaiting `start()` (e.g. daemon boot) never blocks
	 * on a live `gh` call.
	 */
	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		this.stopped = false;
		this.scheduleNext(0);
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

	/**
	 * Run one poll and always schedule the next one. Anything `poll()` throws
	 * (branch resolution on a detached HEAD, a malformed run list, a throwing
	 * `onDetected` or router) backs off rather than ending polling for the
	 * rest of the daemon's life.
	 */
	private async pollOnce(): Promise<void> {
		let nextDelayMs: number;
		try {
			nextDelayMs = await this.poll();
		} catch (err) {
			console.error(`CI watch poll failed: ${formatError(err)}`);
			nextDelayMs = this.backoff.next();
		}
		this.scheduleNext(nextDelayMs);
	}

	/** One poll. Returns the delay before the next one. */
	private async poll(): Promise<number> {
		const branch = this.options.branch ?? (await this.getCurrentBranchFn());

		let raw: string;
		try {
			raw = await this.execGhFn(
				[
					'run',
					'list',
					'--branch',
					branch,
					'--status',
					'completed',
					'--limit',
					String(RUN_LIST_LIMIT),
					'--json',
					'databaseId,conclusion,headSha,workflowName,url,headBranch',
				],
				TIMEOUT_GH_METADATA_MS,
			);
		} catch {
			return this.backoff.next();
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
			return this.backoff.next();
		}
		if (!Array.isArray(runs)) return this.backoff.next();

		this.backoff.reset();

		// Only ever consider the single most recent completed run *per
		// workflow* (gh returns `runs` newest-first, so the first entry seen
		// for a given workflow name is its latest). Without this grouping,
		// widening the fetch to RUN_LIST_LIMIT would treat every failing run
		// in that window as "newly detected" — flooding a fresh activation
		// with a backlog of stale, already-known-broken history instead of
		// just "which workflows are currently red."
		const latestPerWorkflow = new Map<string, RunListEntry>();
		for (const run of runs) {
			if (!latestPerWorkflow.has(run.workflowName)) {
				latestPerWorkflow.set(run.workflowName, run);
			}
		}

		const newlyFailed = [...latestPerWorkflow.values()].filter(
			run =>
				run.conclusion &&
				FAILING_CONCLUSIONS.has(run.conclusion) &&
				!this.seenFailedRunIds.includes(run.databaseId),
		);

		for (const run of newlyFailed) {
			this.seenFailedRunIds.push(run.databaseId);
			const payload: CiJobFailedPayload = {
				runId: run.databaseId,
				workflowName: run.workflowName,
				branch: run.headBranch,
				headSha: run.headSha,
				url: run.url,
			};
			// One run's failed dispatch must not drop the others, or skip
			// persisting the dedup state below.
			try {
				this.options.onDetected?.(payload);
				await this.router.emit({
					kind: 'ci.job.failed',
					payload,
					at: this.now(),
				});
			} catch (err) {
				console.error(
					`CI watch failed to dispatch run ${run.databaseId}: ${formatError(err)}`,
				);
			}
		}

		if (newlyFailed.length > 0) {
			if (this.seenFailedRunIds.length > MAX_TRACKED_RUN_IDS) {
				this.seenFailedRunIds = this.seenFailedRunIds.slice(
					-MAX_TRACKED_RUN_IDS,
				);
			}
			this.options.onSeenFailedRunIdsChanged?.([...this.seenFailedRunIds]);
		}

		return this.pollIntervalMs;
	}
}
