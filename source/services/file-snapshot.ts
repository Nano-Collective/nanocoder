import {execFileSync, execSync} from 'child_process';
import {existsSync} from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import {MAX_CHECKPOINT_FILES} from '@/constants';
import type {CaptureResult, SkippedFile} from '@/types/checkpoint';
import {formatError} from '@/utils/error-formatter';
import {loadGitignore} from '@/utils/gitignore-loader';
import {logWarning} from '@/utils/message-queue';

/**
 * `git diff --name-only HEAD` lists files deleted in the working tree, so a
 * deleted path reaches captureFiles and fails with ENOENT. That is ordinary
 * work - delete a file, take a checkpoint - and recording it as a gap would
 * make every later restore of that checkpoint warn about something that is
 * not missing at all.
 */
function isMissingFile(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as NodeJS.ErrnoException).code === 'ENOENT'
	);
}

/**
 * Service for capturing and restoring file snapshots for checkpoints
 */
export class FileSnapshotService {
	private readonly workspaceRoot: string;

	constructor(workspaceRoot: string = process.cwd()) {
		this.workspaceRoot = workspaceRoot;
	}

	/**
	 * Capture the contents of specified files.
	 *
	 * Read as bytes, never as text. Snapshots cover whatever git reports as
	 * modified, which includes images, .vsix bundles and any other binary a
	 * repository tracks. Decoding those as UTF-8 replaces every invalid byte
	 * with U+FFFD, and since the checkpoint copy is written from this map the
	 * original bytes would be gone at save time with nothing left to recover.
	 *
	 * Files that cannot be read are reported alongside the ones that could, not
	 * just logged: the caller records them so a later restore can say what it
	 * did not put back. A file that is simply gone is not one of them - see
	 * {@link isMissingFile} - so `skipped` means "existed but would not read".
	 */
	async captureFiles(filePaths: string[]): Promise<CaptureResult> {
		const snapshots = new Map<string, Buffer>();
		const skipped: SkippedFile[] = [];

		for (const filePath of filePaths) {
			// Normalized up front so a skipped file is keyed the same way a
			// captured one is; filesChanged and skippedFiles are read side by side.
			const absolutePath = path.resolve(this.workspaceRoot, filePath); // nosemgrep
			const relativePath = path.relative(this.workspaceRoot, absolutePath);
			const normalizedPath = relativePath.split(path.sep).join('/');

			try {
				const content = await fs.readFile(absolutePath);
				snapshots.set(normalizedPath, content);
			} catch (error) {
				const reason = formatError(error);
				if (!isMissingFile(error)) {
					skipped.push({path: normalizedPath, reason});
				}
				// Logged either way: a deleted file is not a gap, but it is still
				// worth seeing in the log when a capture comes out short.
				logWarning('Could not capture file', true, {
					context: {
						filePath,
						error: reason,
					},
				});
			}
		}

		return {snapshots, skipped};
	}

	/**
	 * Restore files from snapshots
	 */
	async restoreFiles(snapshots: Map<string, Buffer>): Promise<void> {
		const errors: string[] = [];

		for (const [relativePath, content] of snapshots) {
			try {
				const absolutePath = path.resolve(this.workspaceRoot, relativePath); // nosemgrep
				// Snapshot keys are read back from user-writable metadata on disk
				// (checkpoint / timeline index files), so a corrupted or tampered
				// index must not be able to write outside the workspace.
				const relative = path.relative(this.workspaceRoot, absolutePath);
				if (relative.startsWith('..') || path.isAbsolute(relative)) {
					throw new Error(
						`Refusing to restore path outside workspace: ${relativePath}`,
					);
				}
				const directory = path.dirname(absolutePath);

				await fs.mkdir(directory, {recursive: true});
				await fs.writeFile(absolutePath, content);
			} catch (error) {
				errors.push(`Failed to restore ${relativePath}: ${formatError(error)}`);
			}
		}

		if (errors.length > 0) {
			throw new Error(`Failed to restore some files:\n${errors.join('\n')}`);
		}
	}

	/**
	 * Get list of modified files in the workspace
	 * Uses git to detect modified files if available, otherwise returns empty array
	 */
	getModifiedFiles(): string[] {
		return this.getModifiedFilesResult().files;
	}

	/**
	 * Same scan as {@link getModifiedFiles}, but reports whether the result was
	 * cut short. Callers that infer a file's *previous* content from the scan
	 * (the action timeline) must not trust a truncated list: a dirty file that
	 * fell outside the cap looks untouched, and its before-image would be taken
	 * from HEAD, discarding the user's uncommitted work on restore.
	 *
	 * `truncatedCount` reports how many the cap dropped rather than only that it
	 * fired, so the number reaches the checkpoint's metadata and, from there, a
	 * later restore. `available` is false when git could not answer at all.
	 */
	getModifiedFilesResult(): {
		files: string[];
		truncated: boolean;
		truncatedCount: number;
		available: boolean;
	} {
		try {
			const modifiedOutput = execSync('git diff --name-only HEAD', {
				cwd: this.workspaceRoot,
				encoding: 'utf-8',
				stdio: ['pipe', 'pipe', 'pipe'],
			}).trim();

			const untrackedOutput = execSync(
				'git ls-files --others --exclude-standard',
				{
					cwd: this.workspaceRoot,
					encoding: 'utf-8',
					stdio: ['pipe', 'pipe', 'pipe'],
				},
			).trim();

			const modifiedFiles = modifiedOutput
				? modifiedOutput.split('\n').filter(Boolean)
				: [];
			const untrackedFiles = untrackedOutput
				? untrackedOutput.split('\n').filter(Boolean)
				: [];

			const allFiles = [...new Set([...modifiedFiles, ...untrackedFiles])];

			// .nanocoderignore only hides files from the model's view; a file the
			// user hid from listings must still be snapshotted, or restoring a
			// checkpoint would silently leave its changes in place.
			const ig = loadGitignore(this.workspaceRoot, {nanocoderIgnore: false});
			const filtered = allFiles.filter(file => !ig.ignores(file));

			if (filtered.length > MAX_CHECKPOINT_FILES) {
				logWarning(
					'Too many modified files detected, limiting to maximum',
					true,
					{
						context: {
							fileCount: filtered.length,
							maxFiles: MAX_CHECKPOINT_FILES,
						},
					},
				);
				return {
					files: filtered.slice(0, MAX_CHECKPOINT_FILES),
					truncated: true,
					truncatedCount: filtered.length - MAX_CHECKPOINT_FILES,
					available: true,
				};
			}

			return {
				files: filtered,
				truncated: false,
				truncatedCount: 0,
				available: true,
			};
		} catch {
			logWarning('Git not available for file tracking', true, {
				context: {
					workspaceRoot: this.workspaceRoot,
				},
			});
			return {
				files: [],
				truncated: false,
				truncatedCount: 0,
				available: false,
			};
		}
	}

	/**
	 * Return HEAD contents of a tracked file, or null if git is unavailable
	 * or the path is not in HEAD (untracked / unknown).
	 */
	getHeadContent(relativePath: string): string | null {
		try {
			return execFileSync('git', ['show', `HEAD:${relativePath}`], {
				cwd: this.workspaceRoot,
				encoding: 'utf-8',
				stdio: ['pipe', 'pipe', 'pipe'],
			});
		} catch {
			return null;
		}
	}

	/**
	 * Delete a file inside the workspace. Refuses paths that escape the root.
	 */
	async deleteFile(relativePath: string): Promise<void> {
		const absolutePath = path.resolve(this.workspaceRoot, relativePath); // nosemgrep
		const relative = path.relative(this.workspaceRoot, absolutePath);
		if (relative.startsWith('..') || path.isAbsolute(relative)) {
			throw new Error(
				`Refusing to delete path outside workspace: ${relativePath}`,
			);
		}
		if (existsSync(absolutePath)) {
			await fs.unlink(absolutePath);
		}
	}

	/**
	 * Get the size of a file snapshot
	 */
	getSnapshotSize(snapshots: Map<string, Buffer>): number {
		let totalSize = 0;
		for (const content of snapshots.values()) {
			totalSize += content.byteLength;
		}
		return totalSize;
	}

	/**
	 * Validate that all files in the snapshot can be written to their locations
	 */
	async validateRestorePath(
		snapshots: Map<string, Buffer>,
	): Promise<{valid: boolean; errors: string[]}> {
		const errors: string[] = [];

		for (const relativePath of snapshots.keys()) {
			const absolutePath = path.resolve(this.workspaceRoot, relativePath); // nosemgrep
			const directory = path.dirname(absolutePath);

			try {
				let dirWritable = true;
				let directoryExists = false;

				try {
					const dirStats = await fs.stat(directory);
					directoryExists = dirStats.isDirectory();
				} catch {
					const parentDir = path.dirname(directory);
					let parentWritable = true;

					if (parentDir !== directory) {
						try {
							const parentStats = await fs.stat(parentDir);
							const parentMode = parentStats.mode;
							// Check if any write permission bit is set - owner: 0o200, group: 0o020, others: 0o002
							const parentHasWritePermission =
								(parentMode & 0o200) !== 0 ||
								(parentMode & 0o020) !== 0 ||
								(parentMode & 0o002) !== 0;

							if (!parentHasWritePermission) {
								parentWritable = false;
								dirWritable = false;
								errors.push(
									`Cannot create directory "${directory}": parent directory "${parentDir}" is read-only`,
								);
							}
						} catch (_parentStatError) {
							parentWritable = true;
						}
					}

					if (parentWritable) {
						try {
							await fs.mkdir(directory, {recursive: true});
							try {
								const verifyStats = await fs.stat(directory);
								directoryExists = verifyStats.isDirectory();
							} catch {
								dirWritable = false;
								directoryExists = false;
								errors.push(
									`Cannot create directory "${directory}": directory creation failed`,
								);
							}
						} catch (mkdirError) {
							dirWritable = false;
							directoryExists = false;
							errors.push(
								`Cannot create directory "${directory}": ${formatError(mkdirError)}`,
							);
						}
					} else {
						directoryExists = false;
					}
				}

				if (dirWritable && directoryExists) {
					try {
						const dirStats = await fs.stat(directory);
						const mode = dirStats.mode;
						const hasWritePermission =
							(mode & 0o200) !== 0 ||
							(mode & 0o020) !== 0 ||
							(mode & 0o002) !== 0;

						if (!hasWritePermission) {
							dirWritable = false;
							errors.push(
								`Directory "${directory}" is not writable: read-only permissions detected`,
							);
						}
					} catch (statError) {
						dirWritable = false;
						errors.push(
							`Directory "${directory}" is not writable: ${formatError(statError)}`,
						);
					}
				}

				// If directory is not writable or was not successfully created, skip further checks for this file
				if (!dirWritable) {
					continue;
				}

				if (existsSync(absolutePath)) {
					try {
						const fileStats = await fs.stat(absolutePath);
						const mode = fileStats.mode;
						const hasWritePermission =
							(mode & 0o200) !== 0 ||
							(mode & 0o020) !== 0 ||
							(mode & 0o002) !== 0;

						if (!hasWritePermission) {
							errors.push(
								`Cannot write to file "${absolutePath}": read-only permissions detected`,
							);
						}
					} catch (fileError) {
						errors.push(
							`Cannot write to file "${absolutePath}": ${formatError(fileError)}`,
						);
					}
				}
			} catch (error) {
				errors.push(
					`Cannot validate path for ${relativePath}: ${formatError(error)}`,
				);
			}
		}
		return {valid: errors.length === 0, errors};
	}
}
