import type {Message} from '@/types/core';

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
