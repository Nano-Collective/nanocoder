import {readFile} from 'node:fs/promises';
import {type FSWatcher, watch} from 'chokidar';
import {type EventRouter, toPosixPath} from '@/events/event-router';
import type {FileChangeEventKind} from '@/types/skills';

export interface FileWatcherOptions {
	root: string;
	ignored?: Array<string | RegExp>;
	usePolling?: boolean;
	pollingInterval?: number;
	/** Enable AI comment detection (AI!, AI?, AI markers). */
	detectAiComments?: boolean;
	/** @internal Test-only: inject a fake chokidar watch factory. */
	_watchFn?: typeof watch;
}

const DEFAULT_IGNORED: Array<string | RegExp> = [
	/(^|[\\/])\.git([\\/]|$)/,
	/(^|[\\/])node_modules([\\/]|$)/,
	/(^|[\\/])\.nanocoder([\\/]|$)/,
];

// Regex to detect AI comment markers at the end of a comment line
const AI_MARKER_REGEX =
	/(?:\/\/|#|<!--|\/\*|\*)\s*.*?\s+(AI!|AI\?|AI)\s*(?:-->|\*\/)?$/i;

interface AiCommentMatch {
	marker: 'AI!' | 'AI?' | 'AI';
	comment: string;
	line: number;
}

export class FileWatcherSource {
	private watcher: FSWatcher | null = null;
	private fileSnapshots: Map<string, Set<string>> = new Map();

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
		this.fileSnapshots.clear();
		await w.close();
	}

	private emit(file: string, eventKind: FileChangeEventKind): void {
		void this.router.emit({
			kind: 'file.changed',
			// Normalized at the boundary, not just in the matcher, so the router,
			// activity reports and the payload handed to a triggered agent all
			// speak one path shape rather than the platform's.
			payload: {file: toPosixPath(file), eventKind},
			at: Date.now(),
		});

		// Check for AI comment markers if enabled
		if (this.options.detectAiComments && eventKind !== 'unlink') {
			void this.checkAiComments(file);
		}
	}

	private async checkAiComments(file: string): Promise<void> {
		try {
			const fullPath = `${this.options.root}/${file}`;
			const content = await readFile(fullPath, 'utf-8');
			const currentMarkers = this.extractAiComments(content);

			// Get previous markers for this file
			const previousMarkers = this.fileSnapshots.get(file) || new Set<string>();
			const currentMarkersSet = new Set(
				currentMarkers.map(m => `${m.line}:${m.marker}:${m.comment}`),
			);

			// Find new markers (not in previous snapshot)
			const newMarkers = currentMarkers.filter(
				m => !previousMarkers.has(`${m.line}:${m.marker}:${m.comment}`),
			);

			// Update snapshot
			this.fileSnapshots.set(file, currentMarkersSet);

			// Emit event for each new marker
			for (const match of newMarkers) {
				const context = this.extractContext(content, match.line);
				void this.router.emit({
					kind: 'file.ai-comment',
					payload: {
						file: toPosixPath(file),
						comment: match.comment,
						marker: match.marker,
						line: match.line,
						context,
					},
					at: Date.now(),
				});
			}
		} catch (_error) {
			// Silently ignore errors (file might be binary, deleted, etc.)
		}
	}

	private extractAiComments(content: string): AiCommentMatch[] {
		const matches: AiCommentMatch[] = [];
		const lines = content.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const match = line?.match(AI_MARKER_REGEX);
			if (match) {
				const marker = match[1]?.toUpperCase() as 'AI!' | 'AI?' | 'AI';
				// Extract the comment part (everything before the marker)
				const commentMatch = line.match(
					/(?:\/\/|#|<!--|\/\*|\*)\s*(.+?)\s+(?:AI!|AI\?|AI)\s*(?:-->|\*\/)?$/i,
				);
				const comment = commentMatch?.[1]?.trim() || '';
				matches.push({
					marker,
					comment,
					line: i + 1, // 1-indexed
				});
			}
		}

		return matches;
	}

	private extractContext(content: string, targetLine: number): string {
		const lines = content.split('\n');
		// Get 5 lines before and after the target line for context
		const start = Math.max(0, targetLine - 6);
		const end = Math.min(lines.length, targetLine + 5);
		return lines.slice(start, end).join('\n');
	}
}
