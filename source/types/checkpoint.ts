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
	fileSnapshots: Map<string, string>;
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
