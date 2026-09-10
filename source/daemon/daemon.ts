/**
 * Per-project daemon entry. Owns the event loop for triggered skill runs.
 *
 * Lifecycle (in order):

 *   1. Boot the unified skill pipeline (legacy loaders + bundle loader +
 *      registrar).
 *   2. Build registries (ToolManager, CustomCommandLoader, SubagentLoader)
 *      and register the loaded skills.
 *   3. Wire the EventRouter through the BackpressureDispatcher into the
 *      SkillDispatcher.
 *   4. Start the file watcher and cron sources, the IPC server, and write
 *      the lockfile.
 *   5. Start CI watch (if enabled) last, once the daemon is otherwise fully
 *      up — its first poll is scheduled rather than awaited, but starting
 *      it after the lockfile write keeps `daemon start`'s report of success
 *      tied to the parts of boot that are actually synchronous/fast.
 *   6. Trap SIGTERM/SIGINT for clean shutdown.
 *
 * The daemon does not draw a TUI - the IPC socket is its surface. The
 * `onActivity` callback writes a log line and fires the OS notification.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 19.
 */

import {CustomCommandLoader} from '@/custom-commands/loader';
import {BackpressureDispatcher} from '@/events/backpressure';
import {EventRouter} from '@/events/event-router';
import {
	type FileWatcherOptions,
	FileWatcherSource,
} from '@/events/sources/file-watcher';
import {
	CiEventSource,
	type CiEventSourceOptions,
} from '@/events/sources/github-checkrun';
import {ScheduleEventSource} from '@/events/sources/schedule';
import type {CiJobFailedPayload} from '@/events/types';
import {bootSkillPipeline} from '@/skills/bootstrap';
import {
	type ActivityListener,
	type Checkpointer,
	type ExecutorFactory,
	SkillDispatcher,
} from '@/skills/dispatcher';
import {getSubagentLoader} from '@/subagents/subagent-loader';
import {
	getPrNumberForBranch,
	isGhAvailable,
	postPrComment,
} from '@/tools/git/utils';
import {ToolManager} from '@/tools/tool-manager';
import type {CiWatchConfig} from '@/types/config';
import {formatError} from '@/utils/error-formatter';
import {sendNotification} from '@/utils/notifications';
import {formatCiReport} from '@/verify/format-ci-report';
import {readCiWatchState, writeCiWatchState} from './ci-watch-state';
import {DaemonIpcServer} from './ipc';
import {
	getSocketPath,
	readLiveLockfile,
	removeLockfile,
	writeLockfile,
} from './lockfile';

export interface DaemonOptions {
	projectRoot: string;
	/** Optional built-in bundle directory shipped with Nanocoder. */
	builtInBundleRoot?: string;
	/**
	 * Factory the dispatcher uses to build a per-run subagent executor.
	 * Production wiring supplies the real one (wraps `SubagentExecutor`);
	 * the daemon spec injects a stub so it can verify wiring without
	 * standing up an LLM client.
	 */
	buildExecutor: ExecutorFactory;
	checkpointer?: Checkpointer;
	/**
	 * Override the activity listener. If omitted, the daemon's default
	 * fires the `triggeredRunComplete` OS notification and broadcasts via
	 * IPC.
	 */
	onActivity?: ActivityListener;
	/**
	 * Background CI-watch config. Disabled unless `ciWatch.enabled` is
	 * true — this is a new always-on-network, GitHub-API-polling feature,
	 * so it's opt-in rather than on by default like file-watching/cron.
	 */
	ciWatch?: CiWatchConfig;
	/**
	 * Test seam: override how the CI-watch event source is constructed.
	 * Defaults to the real `CiEventSource`. Lets specs verify the
	 * enable/gh-availability wiring without a real `CiEventSource.start()`
	 * making a network call.
	 */
	ciEventSourceFactory?: (
		router: EventRouter,
		options: CiEventSourceOptions,
	) => Pick<CiEventSource, 'start' | 'stop'>;
	/**
	 * Test seam: override how the file watcher is constructed. Defaults to
	 * the real `FileWatcherSource`. Lets specs avoid standing up a real,
	 * persistent chokidar watcher against the filesystem.
	 */
	fileWatcherFactory?: (
		router: EventRouter,
		options: FileWatcherOptions,
	) => Pick<FileWatcherSource, 'start' | 'stop'>;
	/**
	 * Test seam: override the gh-availability check gating CI watch.
	 * Defaults to the real `isGhAvailable`.
	 */
	isGhAvailableFn?: () => boolean;
	/**
	 * Test seam: override PR lookup for CI-investigation posting. Defaults
	 * to the real `getPrNumberForBranch`.
	 */
	getPrNumberForBranchFn?: typeof getPrNumberForBranch;
	/**
	 * Test seam: override PR comment posting for CI-investigation posting.
	 * Defaults to the real `postPrComment`.
	 */
	postPrCommentFn?: typeof postPrComment;
}

export interface DaemonHandle {
	stop(): Promise<void>;
}

/**
 * Boot the daemon. Returns a handle for graceful shutdown. The lockfile
 * is written on successful boot and removed on shutdown.
 *
 * Throws if a live daemon is already running for this project (stale
 * lockfiles are reaped automatically).
 */
export async function startDaemon(opts: DaemonOptions): Promise<DaemonHandle> {
	const existing = await readLiveLockfile(opts.projectRoot);
	if (existing) {
		throw new Error(
			`Daemon already running for ${opts.projectRoot} (pid ${existing.pid}, socket ${existing.socketPath}).`,
		);
	}

	// Layer 1: registries
	const toolManager = new ToolManager();
	const commandLoader = new CustomCommandLoader(opts.projectRoot);
	// Use the global singleton: the SubagentExecutor resolves subagents via
	// getSubagentLoader(projectRoot), so a fresh instance here would diverge
	// from what the executor sees. Bundle agents land here via the registrar,
	// and the executor must read from the same instance.
	const subagentLoader = getSubagentLoader(opts.projectRoot);

	// Layer 2: event plumbing
	// `stopHandler` is filled in once `stop` is defined below. The IPC handler
	// captures the holder so a client `shutdown` request can call it without
	// us needing to declare `stop` before the IPC server (it depends on the
	// server itself). On Windows, where SIGTERM is force-kill, this is the
	// only way to get a graceful stop.
	const stopHandler: {fn: (() => Promise<void>) | null} = {fn: null};
	const ipcServer = new DaemonIpcServer(getSocketPath(opts.projectRoot), {
		listSubscriptions: () => router.all(),
		shutdown: async () => {
			if (stopHandler.fn) await stopHandler.fn();
		},
	});

	const getPrNumberForBranchImpl =
		opts.getPrNumberForBranchFn ?? getPrNumberForBranch;
	const postPrCommentImpl = opts.postPrCommentFn ?? postPrComment;

	// A finished CI investigation needs its own post-processing (format the
	// report, post it to the branch's open PR if one exists, fire a
	// CI-specific notification) rather than the generic "a subscription
	// fired" notification every other triggered run gets. Failures to post
	// aren't fatal — swallow-and-log, same fallback posture as
	// `verify --post-review`'s failed post — but the "investigation
	// complete" notification still fires either way, since it reports that
	// the daemon finished investigating and logged a report (true
	// regardless of whether posting to GitHub succeeded), not that the post
	// itself succeeded.
	const handleCiInvestigationComplete = async (
		payload: CiJobFailedPayload,
		subagentOutput: string,
		fixApplied: boolean,
	): Promise<void> => {
		const report = formatCiReport({
			runId: payload.runId,
			workflowName: payload.workflowName,
			branch: payload.branch,
			url: payload.url,
			subagentOutput,
			fixApplied,
		});
		console.log(report);
		try {
			const prNumber = await getPrNumberForBranchImpl(payload.branch);
			if (prNumber) await postPrCommentImpl(prNumber, report);
		} catch (err) {
			console.error(
				`Failed to post CI investigation to PR for branch "${payload.branch}": ${formatError(err)}`,
			);
		}
		sendNotification('ciInvestigationComplete');
	};

	const defaultOnActivity: ActivityListener = activity => {
		const target = `${activity.subscription.target.kind}:${activity.subscription.target.name}`;
		const status = activity.result.success ? 'ok' : 'error';
		const checkpoint = activity.checkpointId
			? ` checkpoint=${activity.checkpointId}`
			: '';
		const errSuffix =
			!activity.result.success && activity.result.error
				? ` error="${activity.result.error}"`
				: '';
		console.log(
			`Triggered run ${status}: target=${target} mode=${activity.mode} ` +
				`event=${activity.event.kind} subscription=${activity.subscription.id} ` +
				`duration=${activity.durationMs}ms${checkpoint}${errSuffix}`,
		);

		// Only the daemon's own hardcoded CI-investigator subscription gets
		// its output auto-posted to a PR. A user-authored skill that also
		// subscribes to `ci.job.failed` gets the same generic notification
		// as any other triggered run — its output was never vetted for
		// "safe to post publicly."
		if (
			activity.event.kind === 'ci.job.failed' &&
			activity.result.success &&
			activity.subscription.id === 'builtin:ci-investigator'
		) {
			void handleCiInvestigationComplete(
				activity.event.payload,
				activity.result.output,
				activity.result.fixApplied ?? false,
			);
			return;
		}

		sendNotification('triggeredRunComplete');
	};

	const skillDispatcher = new SkillDispatcher({
		buildExecutor: opts.buildExecutor,
		checkpointer: opts.checkpointer,
		onActivity: opts.onActivity ?? defaultOnActivity,
		onUnsupportedTarget: (subscription, reason) => {
			console.log(
				`Skipped triggered run: target=${subscription.target.kind}:${subscription.target.name} ` +
					`subscription=${subscription.id} reason="${reason}"`,
			);
		},
	});

	const backpressure = new BackpressureDispatcher(skillDispatcher, {
		onDrop: (subscription, event) => {
			console.log(
				`Dropped event (in-flight run): subscription=${subscription.id} ` +
					`target=${subscription.target.kind}:${subscription.target.name} ` +
					`event=${event.kind}`,
			);
		},
	});
	const router = new EventRouter(backpressure);

	// Layer 3: unified skill boot (legacy loaders + bundle loader + registrar)
	const bootResult = await bootSkillPipeline({
		projectRoot: opts.projectRoot,
		toolManager,
		commandLoader,
		subagentLoader,
		eventRouter: router,
		builtInBundleRoot: opts.builtInBundleRoot,
	});

	// Surface skill load errors and collisions in the daemon log. Without
	// this, malformed manifests, duplicate subscriptions, and bad targets
	// fail silently in headless mode (the TUI path surfaces them via the
	// chat queue, but the daemon has no chat queue).
	for (const err of bootResult.loadErrors) {
		const where = err.filePath ?? err.bundlePath;
		console.error(`Skill load error (${where}): ${err.message}`);
	}
	for (const c of bootResult.registration.collisions) {
		console.error(
			`Skill collision (${c.skill} ${c.kind}:${c.name}): ${c.message}`,
		);
	}
	for (const warning of bootResult.deprecations) {
		console.warn(`Deprecation: ${warning}`);
	}

	const buildFileWatcher =
		opts.fileWatcherFactory ??
		((r: EventRouter, o: FileWatcherOptions) => new FileWatcherSource(r, o));
	const watcher = buildFileWatcher(router, {root: opts.projectRoot});
	const cron = new ScheduleEventSource(router);

	for (const sub of router.listByKind('schedule.cron')) {
		if (sub.kind !== 'schedule.cron' || !sub.filter) continue;
		cron.register(sub.filter.cron);
	}

	// CI watch is opt-in and requires `gh` — construct the source and its
	// built-in subscription only when both hold. The
	// subscription is hardcoded (not derived from any skill file) because
	// this is a built-in feature, not something users author YAML for; it
	// still flows through the exact same router/dispatcher pipeline a
	// skill-declared subscription would.
	const isGhAvailableImpl = opts.isGhAvailableFn ?? isGhAvailable;
	let ciSource: Pick<CiEventSource, 'start' | 'stop'> | undefined;
	if (opts.ciWatch?.enabled) {
		if (isGhAvailableImpl()) {
			router.subscribe({
				id: 'builtin:ci-investigator',
				kind: 'ci.job.failed',
				target: {kind: 'agent', name: 'verify-ci-investigator'},
				source: 'manifest',
				ownerSkill: 'builtin',
			});
			const ciWatchState = await readCiWatchState(opts.projectRoot);
			const buildCiEventSource =
				opts.ciEventSourceFactory ??
				((r: EventRouter, o: CiEventSourceOptions) => new CiEventSource(r, o));
			// Serialize state writes through a promise chain: `pollOnce()` can
			// fire this callback again before the previous write lands (a short
			// custom pollIntervalMs, or a slow filesystem), and unserialized
			// writes could complete out of order, leaving a smaller id set
			// persisted than what was actually last seen.
			let writeQueue = Promise.resolve();
			ciSource = buildCiEventSource(router, {
				pollIntervalMs: opts.ciWatch.pollIntervalMs,
				maxPollIntervalMs: opts.ciWatch.maxPollIntervalMs,
				onDetected: () => sendNotification('ciFailureDetected'),
				initialSeenFailedRunIds: ciWatchState.seenFailedRunIds,
				onSeenFailedRunIdsChanged: ids => {
					writeQueue = writeQueue.then(() =>
						writeCiWatchState(opts.projectRoot, {seenFailedRunIds: ids}).catch(
							err =>
								console.error(
									`Failed to persist CI-watch state: ${formatError(err)}`,
								),
						),
					);
				},
			});
		} else {
			console.log('CI watch is enabled but gh CLI was not found — skipping.');
		}
	}

	// A user-authored skill can subscribe to `ci.job.failed` even when CI
	// watch itself is off (disabled in config, or `gh` missing) — nothing
	// will ever emit that kind in that case, so the subscription is silently
	// dead. Warn at boot rather than leaving the user to debug "my skill
	// never runs" with no clue why.
	if (!ciSource) {
		const dormantCiSubs = router
			.listByKind('ci.job.failed')
			.filter(sub => sub.id !== 'builtin:ci-investigator');
		if (dormantCiSubs.length > 0) {
			console.warn(
				`Warning: ${dormantCiSubs.length} skill subscription(s) to 'ci.job.failed' will never fire ` +
					`because CI watch is not active (nanocoder.ciWatch.enabled is false, or gh CLI was not found): ` +
					dormantCiSubs.map(sub => sub.id).join(', '),
			);
		}
	}

	let stopPromise: Promise<void> | null = null;
	const stop = (): Promise<void> => {
		// Idempotent: subsequent callers get the in-flight Promise so they
		// can await the same shutdown rather than racing it.
		if (stopPromise) return stopPromise;
		stopPromise = (async () => {
			await watcher.stop();
			cron.stop();
			ciSource?.stop();
			backpressure.dispose();
			await ipcServer.stop();
			await removeLockfile(opts.projectRoot);
		})();
		return stopPromise;
	};
	stopHandler.fn = stop;

	await watcher.start();
	await ipcServer.start();

	try {
		await writeLockfile({
			pid: process.pid,
			socketPath: getSocketPath(opts.projectRoot),
			startedAt: Date.now(),
			projectRoot: opts.projectRoot,
		});
	} catch (err) {
		await stop();
		throw err;
	}

	// Started last, and after the lockfile write: `CiEventSource.start()`
	// only schedules a 0ms timer (it doesn't await a live `gh` call), so
	// this doesn't block boot either way — but keeping it after the parts
	// `daemon start` actually waits on keeps that invariant obviously true
	// rather than relying on `CiEventSource`'s internals staying that way.
	// Wrapped the same way as the lockfile write above: a custom
	// `ciEventSourceFactory` (test seam) could hand back a `start()` that
	// throws, and without this the watcher/IPC server/lockfile would already
	// be live with nothing cleaning them up.
	try {
		await ciSource?.start();
	} catch (err) {
		await stop();
		throw err;
	}

	// Signal handling lives in the daemon's process entry point
	// (source/daemon/entry.ts). Registering handlers here too would race
	// the entry's handler and process.exit(0) before our cleanup finishes.

	return {stop};
}
