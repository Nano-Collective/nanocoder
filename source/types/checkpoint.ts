import type {Message} from '@/types/core';

/** A file git reported as modified that the checkpoint could not capture. */
export interface SkippedFile {
	path: string;
	reason: string;
}

/** What captureFiles took, and what it had to leave behind. */
export interface CaptureResult {
	snapshots: Map<string, Buffer>;
	skipped: SkippedFile[];
}

export interface CheckpointMetadata {
	name: string;
	timestamp: string; // ISO 8601 format
	messageCount: number;
	filesChanged: string[]; // Relative file paths
	provider: {
		name: string;
		model: string;
	};
	description?: string; // Optional: first message or custom
	gitCommitHash?: string; // Optional: for future git integration
	// A checkpoint can come out incomplete two ways: a file was unreadable at
	// capture (an editor or antivirus holding a lock, permissions), or the
	// MAX_CHECKPOINT_FILES cap dropped files before capture began. Both are
	// recorded so restore can say so - a partial restore that reports success is
	// the failure this exists to prevent. Optional, so older checkpoints load.
	skippedFiles?: SkippedFile[];
	truncatedFileCount?: number;
}

export interface CheckpointConversation {
	messages: Message[];
	toolExecutions?: Array<{
		tool: string;
		args: Record<string, unknown>;
		result: unknown;
		timestamp: string;
	}>;
}

export interface CheckpointData {
	metadata: CheckpointMetadata;
	conversation: CheckpointConversation;
	// Raw bytes, so a checkpoint round-trip preserves binaries as faithfully as
	// text. Nothing downstream reads a snapshot as a string.
	fileSnapshots: Map<string, Buffer>;
}

export interface CheckpointListItem {
	name: string;
	metadata: CheckpointMetadata;
	sizeBytes?: number;
}

export interface CheckpointValidationResult {
	valid: boolean;
	errors: string[];
	warnings?: string[];
}

export interface CheckpointRestoreOptions {
	createBackup?: boolean;
	backupName?: string;
	validateIntegrity?: boolean;
}
