import {existsSync} from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import {TRUNCATION_DESCRIPTION_LENGTH} from '@/constants';
import type {
	CheckpointConversation,
	CheckpointData,
	CheckpointListItem,
	CheckpointMetadata,
	CheckpointRestoreOptions,
	CheckpointValidationResult,
} from '@/types/checkpoint';
import type {Message} from '@/types/core';
import {
	describeCheckpointGaps,
	validateCheckpointName,
} from '@/utils/checkpoint-utils';
import {formatError} from '@/utils/error-formatter';
import {logWarning} from '@/utils/message-queue';
import {FileSnapshotService} from './file-snapshot';

/**
 * Service for managing conversation checkpoints.
 * Checkpoints are stored in .nanocoder/checkpoints/ within the workspace root.
 */
export class CheckpointManager {
	private readonly checkpointsDir: string;
	private readonly fileSnapshotService: FileSnapshotService;

	private readonly workspaceRoot: string;

	constructor(workspaceRoot: string = process.cwd()) {
		this.workspaceRoot = workspaceRoot;
		// nosemgrep
		this.checkpointsDir = path.join(workspaceRoot, '.nanocoder', 'checkpoints'); // nosemgrep
		this.fileSnapshotService = new FileSnapshotService(workspaceRoot);
	}

	/**
	 * Initialize the checkpoints directory
	 */
	private async ensureCheckpointsDir(): Promise<void> {
		if (!existsSync(this.checkpointsDir)) {
			await fs.mkdir(this.checkpointsDir, {recursive: true});
		}
	}

	/**
	 * Generate a checkpoint name based on timestamp
	 */
	private generateCheckpointName(): string {
		const now = new Date();
		const timestamp = now
			.toISOString()
			.replace(/[:.]/g, '-')
			.replace('T', '-')
			.split('.')[0];
		return `checkpoint-${timestamp}`;
	}

	/**
	 * Get the directory path for a specific checkpoint.
	 *
	 * Every read/mutate method routes through here, so this is the single
	 * place that guards against a name escaping the checkpoints directory
	 * (e.g. `../../etc`). The name is validated for unsafe characters and the
	 * resolved path is checked to stay inside checkpointsDir.
	 */
	private getCheckpointDir(name: string): string {
		this.validateName(name);
		const dir = path.join(this.checkpointsDir, name); // nosemgrep
		const base = path.resolve(this.checkpointsDir); // nosemgrep
		const resolved = path.resolve(dir); // nosemgrep
		if (resolved !== base && !resolved.startsWith(base + path.sep)) {
			throw new Error(`Invalid checkpoint name: '${name}'`);
		}
		return dir;
	}

	/**
	 * Validate checkpoint name using shared utility
	 */
	private validateName(name: string): void {
		const result = validateCheckpointName(name);
		if (!result.valid) {
			throw new Error(result.error || 'Invalid checkpoint name');
		}
	}

	/**
	 * Generate metadata description from messages
	 */
	private generateDescription(messages: Message[]): string {
		const userMessages = messages.filter(m => m.role === 'user');
		if (userMessages.length === 0) {
			return 'Empty conversation';
		}

		const firstMessage = userMessages[0].content;
		// Take first characters and add ellipsis if longer
		return firstMessage.length > TRUNCATION_DESCRIPTION_LENGTH
			? `${firstMessage.substring(0, TRUNCATION_DESCRIPTION_LENGTH)}...`
			: firstMessage;
	}

	/**
	 * Save a checkpoint
	 */
	async saveCheckpoint(
		name: string | undefined,
		messages: Message[],
		provider: string,
		model: string,
		modifiedFiles?: string[],
	): Promise<CheckpointMetadata> {
		await this.ensureCheckpointsDir();

		// Generate name if not provided
		const checkpointName = name || this.generateCheckpointName();
		this.validateName(checkpointName);

		const checkpointDir = this.getCheckpointDir(checkpointName);

		// Check if checkpoint already exists
		if (existsSync(checkpointDir)) {
			throw new Error(`Checkpoint '${checkpointName}' already exists`);
		}

		// Get modified files if not provided. An explicit list is taken as given, so
		// nothing was dropped by the cap in that case.
		const {files: filesToSnapshot, truncatedCount} = modifiedFiles
			? {files: modifiedFiles, truncatedCount: 0}
			: this.fileSnapshotService.getModifiedFilesResult();

		// Capture file snapshots
		const {snapshots: fileSnapshots, skipped} =
			await this.fileSnapshotService.captureFiles(filesToSnapshot);

		// Create metadata
		const metadata: CheckpointMetadata = {
			name: checkpointName,
			timestamp: new Date().toISOString(),
			messageCount: messages.length,
			filesChanged: Array.from(fileSnapshots.keys()),
			filesMissing: filesToSnapshot
				.map(filePath => filePath.split(path.sep).join('/'))
				.filter(
					filePath =>
						!fileSnapshots.has(filePath) &&
						!skipped.some(skippedFile => skippedFile.path === filePath),
				),
			provider: {name: provider, model},
			description: this.generateDescription(messages),
			// Only recorded when the checkpoint really is incomplete, so a clean
			// capture writes the same metadata it always did.
			...(skipped.length > 0 && {skippedFiles: skipped}),
			...(truncatedCount > 0 && {truncatedFileCount: truncatedCount}),
		};

		// Create conversation data
		const conversation: CheckpointConversation = {
			messages: messages.map(msg => ({...msg})), // Deep copy
		};

		// Create checkpoint directory and files
		await fs.mkdir(checkpointDir, {recursive: true});

		// nosemgrep
		// Save metadata
		await fs.writeFile(
			path.join(checkpointDir, 'metadata.json'), // nosemgrep
			JSON.stringify(metadata, null, 2),
			'utf-8',
		);

		// nosemgrep
		// Save conversation
		await fs.writeFile(
			path.join(checkpointDir, 'conversation.json'), // nosemgrep
			JSON.stringify(conversation, null, 2),
			'utf-8',
		);

		// nosemgrep
		// Save file snapshots. No encoding argument: Node writes a Buffer verbatim,
		// which is what keeps binary files intact at rest inside the checkpoint.
		if (fileSnapshots.size > 0) {
			const filesDir = path.join(checkpointDir, 'files'); // nosemgrep
			await fs.mkdir(filesDir, {recursive: true});

			for (const [relativePath, snapshot] of fileSnapshots) {
				const filePath = path.join(filesDir, relativePath); // nosemgrep
				const fileDir = path.dirname(filePath);

				await fs.mkdir(fileDir, {recursive: true});
				await fs.writeFile(filePath, snapshot);
			}
		}

		return metadata;
	}
	/**
	 * Extend an existing checkpoint with file snapshots that were not
	 * known when the checkpoint was originally created.
	 *
	 * This keeps a single logical checkpoint for an Architect turn while
	 * ensuring files first encountered by later tool calls are captured
	 * before they are mutated.
	 */
	async extendCheckpoint(
		name: string,
		modifiedFiles: string[],
	): Promise<CheckpointMetadata> {
		const checkpointDir = this.getCheckpointDir(name);

		if (!existsSync(checkpointDir)) {
			return this.getCheckpointMetadata(name);
		}

		// Load current metadata.
		const metadataPath = path.join(checkpointDir, 'metadata.json'); // nosemgrep
		const metadataContent = await fs.readFile(metadataPath, 'utf-8');
		const metadata = JSON.parse(metadataContent) as CheckpointMetadata;

		const existingFiles = new Set(metadata.filesChanged);
		const newFiles = modifiedFiles.filter(
			relativePath => !existingFiles.has(relativePath),
		);

		// Nothing new to capture.
		if (newFiles.length === 0) {
			return metadata;
		}

		//Capture the new paths BEFORE their mutations execute.
		const {snapshots: fileSnapshots, skipped} =
			await this.fileSnapshotService.captureFiles(newFiles);
		const filesDir = path.join(checkpointDir, 'files'); // nosemgrep
		await fs.mkdir(filesDir, {recursive: true});

		for (const [relativePath, snapshot] of fileSnapshots) {
			const filePath = path.join(filesDir, relativePath); // nosemgrep
			const fileDir = path.dirname(filePath);

			await fs.mkdir(fileDir, {recursive: true});
			await fs.writeFile(filePath, snapshot);
		}

		// Extend metadata while preserving the original checkpoint
		// timestamp and conversation information.
		metadata.filesChanged = [...metadata.filesChanged, ...fileSnapshots.keys()];

		const existingMissing = new Set(metadata.filesMissing ?? []);

		for (const relativePath of newFiles) {
			const normalizedPath = relativePath.split(path.sep).join('/');

			if (
				!fileSnapshots.has(normalizedPath) &&
				!skipped.some(skippedFile => skippedFile.path === normalizedPath)
			) {
				existingMissing.add(normalizedPath);
			}
		}

		metadata.filesMissing = [...existingMissing];

		if (skipped.length > 0) {
			metadata.skippedFiles = [...(metadata.skippedFiles ?? []), ...skipped];
		}

		await fs.writeFile(
			metadataPath,
			JSON.stringify(metadata, null, 2),
			'utf-8',
		);
		return metadata;
	}

	/**
	 * Load a checkpoint
	 */
	async loadCheckpoint(
		name: string,
		options: CheckpointRestoreOptions = {},
	): Promise<CheckpointData> {
		const checkpointDir = this.getCheckpointDir(name);

		if (!existsSync(checkpointDir)) {
			throw new Error(`Checkpoint '${name}' does not exist`);
		}

		// Validate checkpoint if requested
		if (options.validateIntegrity) {
			const validation = await this.validateCheckpoint(name);
			if (!validation.valid) {
				throw new Error(
					`Checkpoint validation failed: ${validation.errors.join(', ')}`,
				);
			}
		}

		// nosemgrep
		// Load metadata
		const metadataPath = path.join(checkpointDir, 'metadata.json'); // nosemgrep
		const metadataContent = await fs.readFile(metadataPath, 'utf-8');
		const metadata = JSON.parse(metadataContent) as CheckpointMetadata;

		// nosemgrep
		// Load conversation
		const conversationPath = path.join(checkpointDir, 'conversation.json'); // nosemgrep
		const conversationContent = await fs.readFile(conversationPath, 'utf-8');
		const conversation = JSON.parse(
			conversationContent,
		) as CheckpointConversation;

		// nosemgrep
		// Load file snapshots
		const fileSnapshots = new Map<string, Buffer>();
		const filesDir = path.join(checkpointDir, 'files'); // nosemgrep

		for (const relativePath of metadata.filesChanged) {
			if (!existsSync(filesDir)) {
				continue;
			}

			try {
				const filePath = path.join(filesDir, relativePath); // nosemgrep
				const content = await fs.readFile(filePath);

				fileSnapshots.set(relativePath, content);
			} catch (error) {
				logWarning('Could not load file snapshot', true, {
					context: {
						relativePath,
						error: formatError(error),
					},
				});
			}
		}

		return {
			metadata,
			conversation,
			fileSnapshots,
		};
	}

	/**
	 * List all available checkpoints
	 */
	async listCheckpoints(): Promise<CheckpointListItem[]> {
		await this.ensureCheckpointsDir();

		try {
			const entries = await fs.readdir(this.checkpointsDir);
			const checkpoints: CheckpointListItem[] = [];

			for (const entry of entries) {
				try {
					const checkpointDir = path.join(this.checkpointsDir, entry); // nosemgrep
					const stat = await fs.stat(checkpointDir);

					if (stat.isDirectory()) {
						const metadataPath = path.join(checkpointDir, 'metadata.json'); // nosemgrep
						if (existsSync(metadataPath)) {
							const metadataContent = await fs.readFile(metadataPath, 'utf-8');
							const metadata = JSON.parse(
								metadataContent,
							) as CheckpointMetadata;

							// Calculate directory size
							const sizeBytes =
								await this.calculateDirectorySize(checkpointDir);

							checkpoints.push({
								name: entry,
								metadata,
								sizeBytes,
							});
						}
					}
				} catch (error) {
					logWarning('Could not read checkpoint', true, {
						context: {
							checkpointName: entry,
							error: formatError(error),
						},
					});
				}
			}

			// Sort by timestamp (newest first)
			checkpoints.sort(
				(a, b) =>
					new Date(b.metadata.timestamp).getTime() -
					new Date(a.metadata.timestamp).getTime(),
			);

			return checkpoints;
		} catch (error) {
			throw new Error(`Failed to list checkpoints: ${formatError(error)}`);
		}
	}

	/**
	 * Delete a checkpoint
	 */
	async deleteCheckpoint(name: string): Promise<void> {
		const checkpointDir = this.getCheckpointDir(name);

		if (!existsSync(checkpointDir)) {
			throw new Error(`Checkpoint '${name}' does not exist`);
		}

		try {
			await fs.rm(checkpointDir, {recursive: true, force: true});
		} catch (error) {
			throw new Error(
				`Failed to delete checkpoint '${name}': ${formatError(error)}`,
			);
		}
	}

	/**
	 * Validate checkpoint integrity
	 */
	async validateCheckpoint(name: string): Promise<CheckpointValidationResult> {
		const checkpointDir = this.getCheckpointDir(name);
		const errors: string[] = [];
		const warnings: string[] = [];

		// Check if checkpoint directory exists
		if (!existsSync(checkpointDir)) {
			errors.push('Checkpoint directory does not exist');
			return {valid: false, errors, warnings};
		}

		// Check metadata file
		const metadataPath = path.join(checkpointDir, 'metadata.json'); // nosemgrep
		if (!existsSync(metadataPath)) {
			errors.push('Missing metadata.json file');
		} else {
			try {
				const metadataContent = await fs.readFile(metadataPath, 'utf-8');
				const metadata = JSON.parse(metadataContent) as CheckpointMetadata;

				// Validate metadata structure
				if (
					!metadata.name ||
					!metadata.timestamp ||
					typeof metadata.messageCount !== 'number'
				) {
					errors.push('Invalid metadata structure');
				}
			} catch (error) {
				errors.push(`Invalid metadata.json: ${formatError(error)}`);
			}
		}

		// Check conversation file
		const conversationPath = path.join(checkpointDir, 'conversation.json'); // nosemgrep
		if (!existsSync(conversationPath)) {
			errors.push('Missing conversation.json file');
		} else {
			try {
				const conversationContent = await fs.readFile(
					conversationPath,
					'utf-8',
				);
				const conversation = JSON.parse(
					conversationContent,
				) as CheckpointConversation;

				// Validate conversation structure
				if (!Array.isArray(conversation.messages)) {
					errors.push('Invalid conversation structure');
				}
			} catch (error) {
				errors.push(`Invalid conversation.json: ${formatError(error)}`);
			}
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
		};
	}

	/**
	 * Restore files from a checkpoint.
	 *
	 * Returns every way this restore put back less than the whole workspace, so
	 * a caller cannot report plain success over an incomplete one. Derived here
	 * rather than left to each restore path: there are three of them today and
	 * the fourth would have to remember.
	 */
	async restoreFiles(checkpointData: CheckpointData): Promise<string[]> {
		// Independent of whether there is anything to write back - a checkpoint
		// whose every file was skipped at capture has no snapshots and nothing
		// but gaps.
		const gaps = describeCheckpointGaps(checkpointData);

		// Files absent at capture are restored by being absent again. Runs
		// before the early return below: a turn that only created files has no
		// snapshots to write back, and skipping the delete there is exactly the
		// case where revert silently left the new files on disk.
		await this.fileSnapshotService.removeFiles(
			checkpointData.metadata.filesMissing ?? [],
		);

		if (checkpointData.fileSnapshots.size === 0) {
			return gaps; // No files to restore
		}

		// Validate restore paths
		const validation = await this.fileSnapshotService.validateRestorePath(
			checkpointData.fileSnapshots,
		);
		if (!validation.valid) {
			throw new Error(`Cannot restore files: ${validation.errors.join(', ')}`);
		}

		// Restore files
		await this.fileSnapshotService.restoreFiles(checkpointData.fileSnapshots);

		return gaps;
	}

	/**
	 * Calculate the total size of a directory
	 */
	private async calculateDirectorySize(dirPath: string): Promise<number> {
		let totalSize = 0;

		try {
			const entries = await fs.readdir(dirPath, {withFileTypes: true});

			for (const entry of entries) {
				const fullPath = path.join(dirPath, entry.name); // nosemgrep

				if (entry.isDirectory()) {
					totalSize += await this.calculateDirectorySize(fullPath);
				} else {
					const stat = await fs.stat(fullPath);
					totalSize += stat.size;
				}
			}
		} catch (error) {
			// If we can't read the directory, just return 0
			logWarning('Could not calculate directory size', true, {
				context: {
					dirPath,
					error: formatError(error),
				},
			});
		}

		return totalSize;
	}

	/**
	 * Check if a checkpoint exists
	 */
	checkpointExists(name: string): boolean {
		const checkpointDir = this.getCheckpointDir(name);
		return existsSync(checkpointDir);
	}

	/**
	 * The checkpointed paths that differ on disk now: snapshotted files whose
	 * bytes changed or that were deleted, and paths absent at capture that now
	 * exist. A checkpoint records every path a tool was ABOUT to touch, so its
	 * own lists include edits that failed or changed nothing.
	 */
	async getChangesSince(
		name: string,
	): Promise<{filesChanged: string[]; filesMissing: string[]}> {
		const {metadata, fileSnapshots} = await this.loadCheckpoint(name);

		const filesChanged: string[] = [];
		for (const relativePath of metadata.filesChanged) {
			const snapshot = fileSnapshots.get(relativePath);
			const absolutePath = path.join(this.workspaceRoot, relativePath); // nosemgrep
			let current: Buffer | null = null;
			try {
				current = await fs.readFile(absolutePath);
			} catch {
				current = null;
			}
			// No snapshot to compare against (unreadable at load): report it
			// rather than hide a change we cannot rule out.
			if (!snapshot || !current || !snapshot.equals(current)) {
				filesChanged.push(relativePath);
			}
		}

		const filesMissing = (metadata.filesMissing ?? []).filter(
			relativePath => existsSync(path.join(this.workspaceRoot, relativePath)), // nosemgrep
		);

		return {filesChanged, filesMissing};
	}

	/**
	 * Get checkpoint metadata without loading full data
	 */
	async getCheckpointMetadata(name: string): Promise<CheckpointMetadata> {
		const checkpointDir = this.getCheckpointDir(name);

		if (!existsSync(checkpointDir)) {
			throw new Error(`Checkpoint '${name}' does not exist`);
		}

		const metadataPath = path.join(checkpointDir, 'metadata.json'); // nosemgrep
		const metadataContent = await fs.readFile(metadataPath, 'utf-8');
		return JSON.parse(metadataContent) as CheckpointMetadata;
	}
}
