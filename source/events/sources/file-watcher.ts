import {readFile, stat} from 'node:fs/promises';
import {extname, join} from 'node:path';
import {type FSWatcher, watch} from 'chokidar';
import {type EventRouter, toPosixPath} from '@/events/event-router';
import type {FileChangeEventKind} from '@/types/skills';

export interface FileWatcherOptions {
	root: string;
	ignored?: Array<string | RegExp>;
	usePolling?: boolean;
	pollingInterval?: number;
	/** Enable AI comment detection (AI! and AI? markers). */
	detectAiComments?: boolean;
	/** @internal Test-only: inject a fake chokidar watch factory. */
	_watchFn?: typeof watch;
}

const DEFAULT_IGNORED: Array<string | RegExp> = [
	/(^|[\\/])\.git([\\/]|$)/,
	/(^|[\\/])node_modules([\\/]|$)/,
	/(^|[\\/])\.nanocoder([\\/]|$)/,
];

/**
 * An AI marker ends a code comment: `// fix this AI!`, `# add retry AI?`,
 * `<!-- rename this AI! -->`, `-- fix this AI!`, a one-line block comment
 * that ends in the marker, or a block-comment continuation line
 * (` * fix this AI!`). It is matched in exact case and needs the `!` or `?`:
 * a bare "AI" ends far too many ordinary lines ("// this module wraps the
 * AI", "# A short history of AI").
 *
 * The delimiter must start the line or follow whitespace, so a `//` inside a
 * URL does not count. Group 1 is the comment text, group 2 the marker.
 */
const AI_MARKER_REGEX =
	/(?:(?:^|\s)(?:\/\/|#|--|\/\*|<!--)|^\s*\*)\s*(.+?)\s+(AI[!?])\s*(?:\*\/|-->)?\s*$/;

/** Prose files: a line there ending in "AI!" is writing, not a request. */
const PROSE_EXTENSIONS = new Set([
	'.md',
	'.mdx',
	'.markdown',
	'.txt',
	'.rst',
	'.adoc',
]);

/** Larger files are skipped rather than read in full on every change. */
const MAX_MARKER_FILE_BYTES = 1_000_000;
const BASELINE_BATCH_SIZE = 32;

interface AiCommentMatch {
	marker: 'AI!' | 'AI?';
	comment: string;
	line: number;
}

function isMarkerCandidate(file: string): boolean {
	return !PROSE_EXTENSIONS.has(extname(file).toLowerCase());
}

/**
 * Markers are identified by their text, not their line: adding a line above
 * one moves it, but it is still the same marker. Identical markers on several
 * lines are counted.
 */
function markerKey(match: AiCommentMatch): string {
	return `${match.marker}:${match.comment}`;
}

function countMarkers(matches: AiCommentMatch[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const match of matches) {
		const key = markerKey(match);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

export class FileWatcherSource {
	private watcher: FSWatcher | null = null;
	private fileSnapshots: Map<string, Map<string, number>> = new Map();
	/** Resolves once the markers already in the tree at startup are recorded. */
	private baseline: Promise<void> = Promise.resolve();

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

		if (this.options.detectAiComments) {
			this.baseline = this.snapshotExistingMarkers(watcher);
		}
	}

	async stop(): Promise<void> {
		if (!this.watcher) return;
		const w = this.watcher;
		this.watcher = null;
		this.fileSnapshots.clear();
		this.baseline = Promise.resolve();
		await w.close();
	}

	/**
	 * Record the markers already in the tree, without emitting, so the first
	 * save of a file after startup only reports markers added since. Files that
	 * are too large or look binary are skipped, as they are for detection.
	 */
	private async snapshotExistingMarkers(watcher: FSWatcher): Promise<void> {
		try {
			const watched =
				typeof watcher.getWatched === 'function' ? watcher.getWatched() : {};
			const files: string[] = [];
			for (const [dir, names] of Object.entries(watched)) {
				for (const name of names) {
					const file = dir === '.' ? name : join(dir, name);
					if (isMarkerCandidate(file)) files.push(file);
				}
			}
			for (let i = 0; i < files.length; i += BASELINE_BATCH_SIZE) {
				await Promise.all(
					files.slice(i, i + BASELINE_BATCH_SIZE).map(async file => {
						// A change that already arrived has its own, newer snapshot.
						if (this.fileSnapshots.has(file)) return;
						const content = await this.readMarkerFile(file);
						if (content === undefined) return;
						if (this.fileSnapshots.has(file)) return;
						this.fileSnapshots.set(
							file,
							countMarkers(this.extractAiComments(content)),
						);
					}),
				);
			}
		} catch {
			// Best effort: without a baseline a first save may report old markers.
		}
	}

	/** The file's text, or undefined for a directory, a large file or a binary. */
	private async readMarkerFile(file: string): Promise<string | undefined> {
		try {
			const fullPath = join(this.options.root, file);
			const info = await stat(fullPath);
			if (!info.isFile() || info.size > MAX_MARKER_FILE_BYTES) return undefined;
			const content = await readFile(fullPath, 'utf-8');
			return content.includes('\0') ? undefined : content;
		} catch {
			// Deleted between the event and the read, or unreadable.
			return undefined;
		}
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
		if (!isMarkerCandidate(file)) return;
		// Markers already in the tree at startup are recorded first, so they
		// are not reported as new the first time their file is saved.
		await this.baseline;
		const content = await this.readMarkerFile(file);
		if (content === undefined) return;

		const current = this.extractAiComments(content);
		const previous = this.fileSnapshots.get(file) ?? new Map<string, number>();
		this.fileSnapshots.set(file, countMarkers(current));

		// A marker is new when its text appears more often than it did before.
		// Moving it, or editing code around it, does not make it new.
		const seen = new Map<string, number>();
		for (const match of current) {
			const key = markerKey(match);
			const occurrence = (seen.get(key) ?? 0) + 1;
			seen.set(key, occurrence);
			if (occurrence <= (previous.get(key) ?? 0)) continue;

			void this.router.emit({
				kind: 'file.ai-comment',
				payload: {
					file: toPosixPath(file),
					comment: match.comment,
					marker: match.marker,
					line: match.line,
					context: this.extractContext(content, match.line),
				},
				at: Date.now(),
			});
		}
	}

	private extractAiComments(content: string): AiCommentMatch[] {
		const matches: AiCommentMatch[] = [];
		const lines = content.split(/\r?\n/);

		for (let i = 0; i < lines.length; i++) {
			const found = AI_MARKER_REGEX.exec(lines[i] ?? '');
			const comment = found?.[1]?.trim();
			if (found?.[2] && comment) {
				matches.push({
					marker: found[2] as 'AI!' | 'AI?',
					comment,
					line: i + 1, // 1-indexed
				});
			}
		}

		return matches;
	}

	private extractContext(content: string, targetLine: number): string {
		const lines = content.split(/\r?\n/);
		// Get 5 lines before and after the target line for context
		const start = Math.max(0, targetLine - 6);
		const end = Math.min(lines.length, targetLine + 5);
		return lines.slice(start, end).join('\n');
	}
}
