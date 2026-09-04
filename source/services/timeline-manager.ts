import {existsSync} from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
	MAX_TIMELINE_ENTRIES,
	MAX_TIMELINE_SESSION_AGE_MS,
	MAX_TIMELINE_SESSIONS,
} from '@/constants';
import type {
	TimelineCaptureInput,
	TimelineEntryMeta,
	TimelineIndex,
	TimelineIndexEntry,
	TimelineRevertResult,
	TimelineScanResult,
} from '@/types/timeline';
import {formatError} from '@/utils/error-formatter';
import {logWarning} from '@/utils/message-queue';
import {FileSnapshotService} from './file-snapshot';
import {
	acquireTimelineLock,
	isTimelineLockLive,
	releaseTimelineLock,
} from './timeline-lock';

/**
 * Paths the timeline must never treat as workspace content. Snapshotting its
 * own before-images would make each opaque capture include the previous one:
 * the entries grow quadratically, crowd out real files under the scan cap, and
 * a revert would rewrite the timeline's internals while walking them.
 *
 * This repo gitignores `.nanocoder/timeline/`, but user projects will not, so
 * the exclusion has to live here rather than rely on `git ls-files` filtering.
 */
const EXCLUDED_PREFIXES = ['.nanocoder/timeline/', '.nanocoder/checkpoints/'];

/**
 * Snapshots round-trip through UTF-8, which silently corrupts binaries. A NUL
 * byte is the same heuristic git uses to call a blob binary.
 */
function isProbablyBinary(content: string): boolean {
	return content.includes('\u0000');
}

/**
 * Per-session log of before-images captured ahead of mutating tool calls.
 * Stored under `.nanocoder/timeline/<sessionId>/`.
 */
export class TimelineManager {
	private readonly workspaceRoot: string;
	private readonly timelineRoot: string;
	private readonly timelineDir: string;
	private readonly fileSnapshotService: FileSnapshotService;
	private readonly sessionId: string;
	private readonly sessionStartedAt: number;
	private lockHeld = false;
	private index: TimelineIndex | null = null;
	private prunedStaleSessions = false;

	constructor(workspaceRoot: string, sessionId: string) {
		this.assertSafeId(sessionId);
		this.workspaceRoot = workspaceRoot;
		this.timelineRoot = path.join(workspaceRoot, '.nanocoder', 'timeline'); // nosemgrep
		this.timelineDir = path.join(this.timelineRoot, sessionId); // nosemgrep
		this.fileSnapshotService = new FileSnapshotService(workspaceRoot);
		this.sessionId = sessionId;
		this.sessionStartedAt = Date.now();
	}

	/**
	 * Best-effort: try to acquire the per-session lock so
	 * pruneStaleSessions will skip this directory while we are still
	 * writing into it. Failure is non-fatal - we log and continue so a
	 * crashed sibling cannot block the chat.
	 */
	private async tryAcquireSessionLock(): Promise<void> {
		// Idempotent: once the lock is held by this manager instance, the
		// on-disk lockfile is ours and a second `ensureDir` call must not
		// race against itself by observing the file as held and
		// resetting `lockHeld` to false.
		if (this.lockHeld) {
			return;
		}
		try {
			const acquired = await acquireTimelineLock(this.timelineDir, {
				pid: process.pid,
				startedAt: this.sessionStartedAt,
			});
			this.lockHeld = acquired;
		} catch (error) {
			logWarning('Could not acquire timeline session lock', true, {
				context: {
					sessionId: this.sessionId,
					error: formatError(error),
				},
			});
		}
	}

	/**
	 * Release the per-session lock and prevent further writes from
	 * touching the session directory. Idempotent.
	 */
	async dispose(): Promise<void> {
		if (!this.lockHeld) {
			return;
		}
		this.lockHeld = false;
		try {
			await releaseTimelineLock(this.timelineDir);
		} catch (error) {
			logWarning('Could not release timeline session lock', true, {
				context: {
					sessionId: this.sessionId,
					error: formatError(error),
				},
			});
		}
	}

	toRelativePath(filePath: string): string | null {
		const absolutePath = path.resolve(this.workspaceRoot, filePath); // nosemgrep
		const relative = path.relative(this.workspaceRoot, absolutePath);
		if (relative.startsWith('..') || path.isAbsolute(relative)) {
			return null;
		}
		const normalized = relative.split(path.sep).join('/');
		if (EXCLUDED_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
			return null;
		}
		return normalized;
	}

	/**
	 * Dirty files in the workspace, plus whether the scan can be trusted as a
	 * complete picture. See `FileSnapshotService.getModifiedFilesResult`.
	 */
	getModifiedFiles(): TimelineScanResult {
		return this.fileSnapshotService.getModifiedFilesResult();
	}

	/**
	 * The before-image for a file that was clean when the tool started.
	 *
	 * `absent` means the path is not in HEAD, so the tool created it and a
	 * revert should delete it. `binary` is distinct from `absent` on purpose:
	 * collapsing the two would make a revert delete a tracked binary the tool
	 * merely edited.
	 */
	readHeadSnapshot(
		relativePath: string,
	): {kind: 'text'; content: string} | {kind: 'binary'} | {kind: 'absent'} {
		const content = this.fileSnapshotService.getHeadContent(relativePath);
		if (content === null) {
			return {kind: 'absent'};
		}
		if (isProbablyBinary(content)) {
			return {kind: 'binary'};
		}
		return {kind: 'text', content};
	}

	fileExists(relativePath: string): boolean {
		const absolutePath = path.resolve(this.workspaceRoot, relativePath); // nosemgrep
		return existsSync(absolutePath);
	}

	/**
	 * Snapshot the given paths. Missing files are recorded as `null` so a
	 * revert deletes them. Binary files are dropped entirely: a corrupt
	 * before-image is worse than no undo point.
	 */
	async snapshotPaths(
		filePaths: string[],
	): Promise<Map<string, string | null>> {
		const result = new Map<string, string | null>();
		const existing: string[] = [];

		for (const filePath of filePaths) {
			const relative = this.toRelativePath(filePath);
			if (!relative) {
				continue;
			}
			if (this.fileExists(relative)) {
				existing.push(relative);
			} else {
				result.set(relative, null);
			}
		}

		if (existing.length > 0) {
			const captured = await this.fileSnapshotService.captureFiles(existing);
			for (const [relative, content] of captured) {
				if (isProbablyBinary(content)) {
					logWarning('Skipping binary file in action timeline', true, {
						context: {relativePath: relative},
					});
					continue;
				}
				result.set(relative, content);
			}
		}

		return result;
	}

	async list(): Promise<TimelineEntryMeta[]> {
		const index = await this.loadIndex();
		return index.entries.map(entry => this.toMeta(entry));
	}

	async capture(
		input: TimelineCaptureInput,
	): Promise<TimelineEntryMeta | null> {
		if (input.files.size === 0) {
			return null;
		}

		await this.ensureDir();
		const index = await this.loadIndex();

		const createdFiles: string[] = [];
		const existing = new Map<string, string>();
		for (const [relative, content] of input.files) {
			const normalized = this.toRelativePath(relative);
			if (!normalized) {
				continue;
			}
			if (content === null) {
				createdFiles.push(normalized);
			} else {
				existing.set(normalized, content);
			}
		}

		if (createdFiles.length === 0 && existing.size === 0) {
			return null;
		}

		const id = crypto.randomUUID();
		const entry: TimelineIndexEntry = {
			id,
			seq: index.nextSeq,
			toolCallId: input.toolCallId,
			toolName: input.toolName,
			title: input.title,
			timestamp: new Date().toISOString(),
			truncateToMessageIndex: input.truncateToMessageIndex,
			filesChanged: [...existing.keys(), ...createdFiles],
			createdFiles,
		};

		if (existing.size > 0) {
			const filesDir = this.entryFilesDir(id);
			await fs.mkdir(filesDir, {recursive: true});
			for (const [relativePath, content] of existing) {
				const filePath = path.join(filesDir, relativePath); // nosemgrep
				await fs.mkdir(path.dirname(filePath), {recursive: true});
				await fs.writeFile(filePath, content, 'utf-8');
			}
		}

		index.entries.push(entry);
		index.nextSeq += 1;
		await this.pruneOldest(index);
		await this.saveIndex(index);

		return this.toMeta(entry);
	}

	async revertTo(checkpointId: string): Promise<TimelineRevertResult> {
		const index = await this.loadIndex();
		const found = index.entries.findIndex(entry => entry.id === checkpointId);
		if (found === -1) {
			throw new Error(`Timeline checkpoint '${checkpointId}' does not exist`);
		}

		// One assistant turn can issue several tool calls, and the conversation
		// can only be truncated to the whole turn. Reverting just the second
		// call of a turn would erase the first call from history while leaving
		// its edits on disk, so widen the range to the start of the turn. Every
		// checkpoint from the same turn shares a truncation point, and message
		// indexes only grow, so a match is always the same turn.
		const targetIndex = this.expandToTurnStart(index, found);

		const toRevert = index.entries.slice(targetIndex).reverse();
		const filesRestored: string[] = [];

		for (const entry of toRevert) {
			const restored = await this.restoreEntry(entry);
			filesRestored.push(...restored);
		}

		index.entries = index.entries.slice(0, targetIndex);
		await this.saveIndex(index);

		for (const entry of toRevert) {
			await this.removeEntryDir(entry.id);
		}

		return {
			revertedTo: this.toMeta(toRevert[toRevert.length - 1]),
			filesRestored: [...new Set(filesRestored)],
		};
	}

	async clear(): Promise<void> {
		this.index = {
			nextSeq: 1,
			entries: [],
		};
		if (existsSync(this.timelineDir)) {
			await fs.rm(this.timelineDir, {recursive: true, force: true});
		}
	}

	/**
	 * Index of the first checkpoint belonging to the same assistant turn as
	 * `entryIndex`.
	 */
	private expandToTurnStart(index: TimelineIndex, entryIndex: number): number {
		const turn = index.entries[entryIndex].truncateToMessageIndex;
		let start = entryIndex;
		while (
			start > 0 &&
			index.entries[start - 1].truncateToMessageIndex === turn
		) {
			start -= 1;
		}
		return start;
	}

	private async restoreEntry(entry: TimelineIndexEntry): Promise<string[]> {
		const restored: string[] = [];
		const created = new Set(entry.createdFiles);
		const snapshots = new Map<string, string>();
		const filesDir = this.entryFilesDir(entry.id);

		for (const indexedPath of entry.filesChanged) {
			// The index is user-writable JSON on disk. Re-validate every path
			// before it reaches a write or an unlink, rather than trusting the
			// normalisation that happened at capture time.
			const relativePath = this.toRelativePath(indexedPath);
			if (!relativePath || relativePath !== indexedPath) {
				logWarning('Ignoring unsafe path in timeline index', true, {
					context: {relativePath: indexedPath},
				});
				continue;
			}

			if (created.has(relativePath)) {
				try {
					await this.fileSnapshotService.deleteFile(relativePath);
					restored.push(relativePath);
				} catch (error) {
					logWarning('Could not delete created timeline file', true, {
						context: {
							relativePath,
							error: formatError(error),
						},
					});
				}
				continue;
			}

			try {
				const filePath = path.join(filesDir, relativePath); // nosemgrep
				const content = await fs.readFile(filePath, 'utf-8');
				snapshots.set(relativePath, content);
			} catch (error) {
				logWarning('Could not load timeline file snapshot', true, {
					context: {
						relativePath,
						error: formatError(error),
					},
				});
			}
		}

		if (snapshots.size > 0) {
			await this.fileSnapshotService.restoreFiles(snapshots);
			restored.push(...snapshots.keys());
		}

		return restored;
	}

	private async pruneOldest(index: TimelineIndex): Promise<void> {
		while (index.entries.length > MAX_TIMELINE_ENTRIES) {
			const oldest = index.entries.shift();
			if (oldest) {
				await this.removeEntryDir(oldest.id);
			}
		}
	}

	private async removeEntryDir(id: string): Promise<void> {
		const dir = path.join(this.timelineDir, 'entries', id); // nosemgrep
		if (existsSync(dir)) {
			await fs.rm(dir, {recursive: true, force: true});
		}
	}

	private entryFilesDir(id: string): string {
		return path.join(this.timelineDir, 'entries', id, 'files'); // nosemgrep
	}

	private toMeta(entry: TimelineIndexEntry): TimelineEntryMeta {
		return {
			id: entry.id,
			seq: entry.seq,
			toolCallId: entry.toolCallId,
			toolName: entry.toolName,
			title: entry.title,
			timestamp: entry.timestamp,
			truncateToMessageIndex: entry.truncateToMessageIndex,
			filesChanged: entry.filesChanged,
		};
	}

	private async ensureDir(): Promise<void> {
		await this.pruneStaleSessions();
		// Try to acquire the session lock before any writes land. The
		// session directory may not exist yet, so mkdir is the safe path.
		if (!existsSync(this.timelineDir)) {
			await fs.mkdir(this.timelineDir, {recursive: true});
		}
		await this.tryAcquireSessionLock();
		await this.touchSessionDir();
	}

	/**
	 * Refresh the session directory's mtime so it stays out of both the
	 * age-based and the count-based prune windows. utimes is a single
	 * syscall and never throws on a directory we just created.
	 */
	private async touchSessionDir(): Promise<void> {
		try {
			const now = new Date();
			await fs.utimes(this.timelineDir, now, now);
		} catch {
			// Best-effort: a stale mtime may let pruning take this
			// session out of rotation, but the live-lock check below
			// still prevents the directory from being deleted out
			// from under us.
		}
	}

	/**
	 * Drop before-images left behind by sessions that were never cleared or
	 * deleted. Without this the timeline root grows without bound inside the
	 * user's workspace. Runs at most once per manager, and never removes the
	 * session this manager owns.
	 */
	private async pruneStaleSessions(): Promise<void> {
		if (this.prunedStaleSessions) {
			return;
		}
		this.prunedStaleSessions = true;

		try {
			const names = await fs.readdir(this.timelineRoot);
			const others: Array<{dir: string; mtimeMs: number}> = [];
			for (const name of names) {
				const dir = path.join(this.timelineRoot, name); // nosemgrep
				if (dir === this.timelineDir) {
					continue;
				}
				const stats = await fs.stat(dir);
				if (stats.isDirectory()) {
					others.push({dir, mtimeMs: stats.mtimeMs});
				}
			}

			const cutoff = Date.now() - MAX_TIMELINE_SESSION_AGE_MS;
			// Newest first, so the slice past the cap is the oldest sessions.
			others.sort((a, b) => b.mtimeMs - a.mtimeMs);
			const stale = others.filter(
				(entry, position) =>
					entry.mtimeMs < cutoff || position >= MAX_TIMELINE_SESSIONS,
			);

			for (const entry of stale) {
				// An active session may have stale mtimeMs (mid-tool-call
				// with no recent capture) but still be writing. Probe its
				// lockfile before removing the directory.
				const lockInfo = await isTimelineLockLive(entry.dir);
				if (lockInfo.live) {
					continue;
				}
				await fs.rm(entry.dir, {recursive: true, force: true});
			}
		} catch {
			// The root may not exist yet, or may not be readable. Pruning is
			// housekeeping; never let it block a capture.
		}
	}

	private indexPath(): string {
		return path.join(this.timelineDir, 'timeline.json'); // nosemgrep
	}

	private async loadIndex(): Promise<TimelineIndex> {
		if (this.index) {
			return this.index;
		}

		const indexPath = this.indexPath();
		if (!existsSync(indexPath)) {
			this.index = {nextSeq: 1, entries: []};
			return this.index;
		}

		try {
			const raw = await fs.readFile(indexPath, 'utf-8');
			const parsed = JSON.parse(raw) as TimelineIndex;
			if (
				!Array.isArray(parsed.entries) ||
				typeof parsed.nextSeq !== 'number'
			) {
				throw new Error('Invalid timeline index');
			}
			this.index = parsed;
			return this.index;
		} catch (error) {
			logWarning('Could not read timeline index, starting empty', true, {
				context: {error: formatError(error)},
			});
			this.index = {nextSeq: 1, entries: []};
			return this.index;
		}
	}

	private async saveIndex(index: TimelineIndex): Promise<void> {
		this.index = index;
		await this.ensureDir();
		await fs.writeFile(
			this.indexPath(),
			JSON.stringify(index, null, 2),
			'utf-8',
		);
	}

	private assertSafeId(id: string): void {
		if (!id || id.length > 100 || id.includes('..') || id.startsWith('.')) {
			throw new Error(`Invalid timeline session id: '${id}'`);
		}
		if (/[<>:"/\\|?*]/.test(id)) {
			throw new Error(`Invalid timeline session id: '${id}'`);
		}
	}
}
