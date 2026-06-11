/**
 * File-system event source for the skill event router.
 *
 * Wraps `chokidar` so callers don't depend on it directly. Watches the
 * project root (with sensible default ignores: `node_modules`, `.git`,
 * `.nanocoder/daemon.*`) and emits `file.changed` events with paths
 * relative to that root - the same shape `subscribe.paths` globs are
 * written against.
 *
 * The source is intentionally dumb: it emits every matching FS event into
 * the router. Subscription-level filtering (paths, eventKinds) happens
 * inside the router, since multiple subscriptions can share one source.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 9.
 */

import {type FSWatcher, watch} from 'chokidar';
import type {EventRouter} from '@/events/event-router';
import type {FileChangeEventKind} from '@/types/skills';
import { relative, isAbsolute } from 'node:path';

export interface FileWatcherOptions {
	/** Directory the watcher treats as root; emitted paths are relative. */
	root: string;
	/**
	 * chokidar `ignored` patterns. Falls back to a default that skips
	 * `node_modules`, `.git`, and `.nanocoder/daemon.*` lockfile churn.
	 */
	ignored?: Array<string | RegExp>;
	/**
	 * Force chokidar into polling mode. Defaults to false. Tests should set
	 * this true on platforms where native fs events are flaky.
	 */
	usePolling?: boolean;
	/** Polling interval in ms when `usePolling` is true. Defaults to 50. */
	pollingInterval?: number;
	  _watchFn?: typeof watch;
}

// `.nanocoder/` holds the daemon's own state (lockfile, socket, checkpoints,
// skills, etc.). Watching it creates a feedback loop: triggered runs write
// checkpoints under .nanocoder/checkpoints/, which fire file.changed events,
// which trigger more runs. The contents of .nanocoder/ are loaded once at
// boot - no hot reload - so excluding the whole tree is safe and prevents
// chokidar from exhausting the FD limit on checkpoint-heavy projects.
const DEFAULT_IGNORED: Array<string | RegExp> = [
	/(^|[\\/])\.git([\\/]|$)/,
	/(^|[\\/])node_modules([\\/]|$)/,
	/(^|[\\/])\.nanocoder([\\/]|$)/,
];

export class FileWatcherSource {
    private watcher: FSWatcher | null = null;

    constructor(
        private readonly router: EventRouter,
        private readonly options: FileWatcherOptions,
    ) {}

    async start(): Promise<void> {
        if (this.watcher) return;

        const watchFn = this.options._watchFn ?? watch;
        
      
        const rootDir = this.options.root;
        const ignored = this.options.ignored ?? DEFAULT_IGNORED;

        const watcher = watchFn(rootDir, {
            ignored,
            persistent: true,
            ignoreInitial: true, 
            usePolling: this.options.usePolling ?? false,
            interval: this.options.pollingInterval ?? 50,
        });

        watcher.on('add', file => this.emit(file, 'add'));
        watcher.on('change', file => this.emit(file, 'change'));
        watcher.on('unlink', file => this.emit(file, 'unlink'));

        try {
            await new Promise<void>((resolve, reject) => {
                watcher.once('ready', () => resolve());
                watcher.once('error', reject);
            });

            this.watcher = watcher;
        } catch (error) {
           
            await watcher.close();
            throw error;
        }
    }

    async stop(): Promise<void> {
        if (!this.watcher) return;
        const w = this.watcher;
        this.watcher = null;
        await w.close();
    }

    private emit(file: string, eventKind: FileChangeEventKind): void {
    
        let relativePath = file;
        if (isAbsolute(file)) {
            relativePath = relative(this.options.root, file);
        } else if (file.startsWith(this.options.root)) {
           
            relativePath = relative(this.options.root, file);
        }

        
        relativePath = relativePath.replace(/\\/g, '/');

        void this.router.emit({
            kind: 'file.changed',
            payload: { file: relativePath, eventKind },
            at: Date.now(),
        });
    }
}
