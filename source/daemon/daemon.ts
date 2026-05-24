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
 *   4. Start event sources (file watcher + cron) and the IPC server.
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
import {FileWatcherSource} from '@/events/sources/file-watcher';
import {ScheduleEventSource} from '@/events/sources/schedule';
import {bootSkillPipeline} from '@/skills/bootstrap';
import {
	type ActivityListener,
	type Checkpointer,
	type ExecutorFactory,
	SkillDispatcher,
} from '@/skills/dispatcher';
import {getSubagentLoader} from '@/subagents/subagent-loader';
import {ToolManager} from '@/tools/tool-manager';
import {sendNotification} from '@/utils/notifications';
import {DaemonIpcServer} from './ipc';
import {
	getLockfilePath,
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
	const ipcServer = new DaemonIpcServer(getSocketPath(opts.projectRoot), {
		listSubscriptions: () => router.all(),
	});

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

	const watcher = new FileWatcherSource(router, {root: opts.projectRoot});
	const cron = new ScheduleEventSource(router);

	for (const sub of router.listByKind('schedule.cron')) {
		if (sub.kind !== 'schedule.cron' || !sub.filter) continue;
		cron.register(sub.filter.cron);
	}

	await watcher.start();
	await ipcServer.start();

	await writeLockfile({
		pid: process.pid,
		socketPath: getSocketPath(opts.projectRoot),
		startedAt: Date.now(),
		projectRoot: opts.projectRoot,
	});

	let stopPromise: Promise<void> | null = null;
	const stop = (): Promise<void> => {
		// Idempotent: subsequent callers get the in-flight Promise so they
		// can await the same shutdown rather than racing it.
		if (stopPromise) return stopPromise;
		stopPromise = (async () => {
			await watcher.stop();
			cron.stop();
			backpressure.dispose();
			await ipcServer.stop();
			await removeLockfile(opts.projectRoot);
		})();
		return stopPromise;
	};

	// Signal handling lives in the daemon's process entry point
	// (source/daemon/entry.ts). Registering handlers here too would race
	// the entry's handler and process.exit(0) before our cleanup finishes.

	return {stop};
}

export {getLockfilePath, getSocketPath};
