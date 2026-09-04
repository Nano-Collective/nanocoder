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
 *   4. Start event sources (file watcher + cron + optional CI watch) and
 *      the IPC server.
 *   5. Write the lockfile, trap SIGTERM/SIGINT for clean shutdown.
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

	// A finished CI investigation needs its own post-processing (format the
	// report, post it to the branch's open PR if one exists, fire a
	// CI-specific notification) rather than the generic "a subscription
	// fired" notification every other triggered run gets. Failures aren't
	// posted anywhere — swallow-and-log, same fallback posture as
	// `verify --post-review`'s failed post.
	const handleCiInvestigationComplete = async (
		payload: CiJobFailedPayload,
		subagentOutput: string,
	): Promise<void> => {
		const report = formatCiReport({
			runId: payload.runId,
			workflowName: payload.workflowName,
			branch: payload.branch,
			url: payload.url,
			subagentOutput,
		});
		console.log(report);
		try {
			const prNumber = await getPrNumberForBranch(payload.branch);
			if (prNumber) await postPrComment(prNumber, report);
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

		if (activity.event.kind === 'ci.job.failed' && activity.result.success) {
			void handleCiInvestigationComplete(
				activity.event.payload,
				activity.result.output,
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
	let ciSource: Pick<CiEventSource, 'start' | 'stop'> | undefined;
	if (opts.ciWatch?.enabled) {
		if (isGhAvailable()) {
			router.subscribe({
				id: 'builtin:ci-investigator',
				kind: 'ci.job.failed',
				target: {kind: 'agent', name: 'verify-ci-investigator'},
				source: 'manifest',
				ownerSkill: 'builtin',
			});
			const buildCiEventSource =
				opts.ciEventSourceFactory ??
				((r: EventRouter, o: CiEventSourceOptions) => new CiEventSource(r, o));
			ciSource = buildCiEventSource(router, {
				pollIntervalMs: opts.ciWatch.pollIntervalMs,
				maxPollIntervalMs: opts.ciWatch.maxPollIntervalMs,
				onDetected: () => sendNotification('ciFailureDetected'),
			});
		} else {
			console.log('CI watch is enabled but gh CLI was not found — skipping.');
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
	await ciSource?.start();
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

	// Signal handling lives in the daemon's process entry point
	// (source/daemon/entry.ts). Registering handlers here too would race
	// the entry's handler and process.exit(0) before our cleanup finishes.

	return {stop};
}
