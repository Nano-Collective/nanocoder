import {existsSync} from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import {MAX_TIMELINE_ENTRIES} from '@/constants';
import type {
	TimelineCaptureInput,
	TimelineEntryMeta,
	TimelineIndex,
	TimelineIndexEntry,
	TimelineRevertResult,
} from '@/types/timeline';
import {formatError} from '@/utils/error-formatter';
import {logWarning} from '@/utils/message-queue';
import {FileSnapshotService} from './file-snapshot';

/**
 * Per-session log of before-images captured ahead of mutating tool calls.
 * Stored under `.nanocoder/timeline/<sessionId>/`.
 */
export class TimelineManager {
	private readonly workspaceRoot: string;
	private readonly timelineDir: string;
	private readonly fileSnapshotService: FileSnapshotService;
	private index: TimelineIndex | null = null;

	constructor(workspaceRoot: string, sessionId: string) {
		this.assertSafeId(sessionId);
		this.workspaceRoot = workspaceRoot;
		// nosemgrep
		this.timelineDir = path.join(
			workspaceRoot,
			'.nanocoder',
			'timeline',
			sessionId,
		);
		this.fileSnapshotService = new FileSnapshotService(workspaceRoot);
	}

	toRelativePath(filePath: string): string | null {
		const absolutePath = path.resolve(this.workspaceRoot, filePath); // nosemgrep
		const relative = path.relative(this.workspaceRoot, absolutePath);
		if (relative.startsWith('..') || path.isAbsolute(relative)) {
			return null;
		}
		return relative.split(path.sep).join('/');
	}

	getModifiedFiles(): string[] {
		return this.fileSnapshotService.getModifiedFiles();
	}

	getHeadContent(relativePath: string): string | null {
		return this.fileSnapshotService.getHeadContent(relativePath);
	}

	fileExists(relativePath: string): boolean {
		const absolutePath = path.resolve(this.workspaceRoot, relativePath); // nosemgrep
		return existsSync(absolutePath);
	}

	/**
	 * Snapshot the given paths. Missing files are recorded as `null`.
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
		const targetIndex = index.entries.findIndex(
			entry => entry.id === checkpointId,
		);
		if (targetIndex === -1) {
			throw new Error(`Timeline checkpoint '${checkpointId}' does not exist`);
		}

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

	private async restoreEntry(entry: TimelineIndexEntry): Promise<string[]> {
		const restored: string[] = [];
		const created = new Set(entry.createdFiles);
		const snapshots = new Map<string, string>();
		const filesDir = this.entryFilesDir(entry.id);

		for (const relativePath of entry.filesChanged) {
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
		if (!existsSync(this.timelineDir)) {
			await fs.mkdir(this.timelineDir, {recursive: true});
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
