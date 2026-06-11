import {type FSWatcher, watch} from 'chokidar';
import type {EventRouter} from '@/events/event-router';
import type {FileChangeEventKind} from '@/types/skills';

export interface FileWatcherOptions {
    root: string;
    ignored?: Array<string | RegExp>;
    usePolling?: boolean;
    pollingInterval?: number;
    /** @internal Test-only: inject a fake chokidar watch factory. */
    _watchFn?: typeof watch;
}

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

        // Watch '.' with cwd set to root so chokidar emits paths relative
        // to root — no manual relativization needed in emit().
        const watcher = watchFn('.', {
            cwd: this.options.root,
            ignored: this.options.ignored ?? DEFAULT_IGNORED,
            ignoreInitial: true,
            persistent: true,
            usePolling: this.options.usePolling ?? false,
            interval: this.options.pollingInterval ?? 50,
            binaryInterval: this.options.pollingInterval ?? 50,
        });

        watcher.on('add',    file => this.emit(file, 'add'));
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
        void this.router.emit({
            kind: 'file.changed',
            payload: {file, eventKind},
            at: Date.now(),
        });
    }
}