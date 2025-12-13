import * as fs from 'fs/promises';
import * as path from 'path';
import {existsSync} from 'fs';
import {execSync} from 'child_process';
import {logWarning} from '@/utils/message-queue';

/**
 * Maximum number of files to capture in a checkpoint.
 * This limit prevents excessive memory usage and storage for large workspaces.
 */
const MAX_CHECKPOINT_FILES = 50;

/**
 * Service for capturing and restoring file snapshots for checkpoints
 */
export class FileSnapshotService {
	private readonly workspaceRoot: string;

	constructor(workspaceRoot: string = process.cwd()) {
		this.workspaceRoot = workspaceRoot;
	}

	/**
	 * Capture the contents of specified files
	 */
	async captureFiles(filePaths: string[]): Promise<Map<string, string>> {
		const snapshots = new Map<string, string>();

		for (const filePath of filePaths) {
			try {
				const absolutePath = path.resolve(this.workspaceRoot, filePath);
				const content = await fs.readFile(absolutePath, 'utf-8');
				const relativePath = path.relative(this.workspaceRoot, absolutePath);
				snapshots.set(relativePath, content);
			} catch (error) {
				logWarning('Could not capture file', true, {
					context: {
						filePath,
						error: error instanceof Error ? error.message : 'Unknown error',
					},
				});
			}
		}

		return snapshots;
	}

	/**
	 * Restore files from snapshots
	 */
	async restoreFiles(snapshots: Map<string, string>): Promise<void> {
		const errors: string[] = [];

		for (const [relativePath, content] of snapshots) {
			try {
				const absolutePath = path.resolve(this.workspaceRoot, relativePath);
				const directory = path.dirname(absolutePath);

				await fs.mkdir(directory, {recursive: true});
				await fs.writeFile(absolutePath, content, 'utf-8');
			} catch (error) {
				errors.push(
					`Failed to restore ${relativePath}: ${
						error instanceof Error ? error.message : 'Unknown error'
					}`,
				);
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

			const filtered = allFiles.filter(file => {
				const ignorePatterns = [
					'node_modules/',
					'dist/',
					'build/',
					'.git/',
					'.nanocoder/',
					'coverage/',
					'*.log',
				];

				return !ignorePatterns.some(pattern => {
					if (pattern.endsWith('/')) {
						return file.startsWith(pattern);
					}
					if (pattern.startsWith('*.')) {
						return file.endsWith(pattern.slice(1));
					}
					return file.includes(pattern);
				});
			});

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
				return filtered.slice(0, MAX_CHECKPOINT_FILES);
			}

			return filtered;
		} catch {
			logWarning('Git not available for file tracking', true, {
				context: {
					workspaceRoot: this.workspaceRoot,
				},
			});
			return [];
		}
	}

	/**
	 * Get the size of a file snapshot
	 */
	getSnapshotSize(snapshots: Map<string, string>): number {
		let totalSize = 0;
		for (const content of snapshots.values()) {
			totalSize += Buffer.byteLength(content, 'utf-8');
		}
		return totalSize;
	}

	/**
	 * Validate that all files in the snapshot can be written to their locations
	 */
	async validateRestorePath(
		snapshots: Map<string, string>,
	): Promise<{valid: boolean; errors: string[]}> {
		const errors: string[] = [];

		for (const relativePath of snapshots.keys()) {
			try {
				const absolutePath = path.resolve(this.workspaceRoot, relativePath);
				const directory = path.dirname(absolutePath);

				await fs.access(directory, fs.constants.W_OK).catch(async () => {
					await fs.mkdir(directory, {recursive: true});
				});

				if (existsSync(absolutePath)) {
					await fs.access(absolutePath, fs.constants.W_OK);
				}
			} catch (error) {
				errors.push(
					`Cannot write to ${relativePath}: ${
						error instanceof Error ? error.message : 'Unknown error'
					}`,
				);
			}
		}

		return {
			valid: errors.length === 0,
			errors,
		};
	}
}
