import type {ImageAttachment} from '@/types/core';

// Enum for all supported placeholder types - ensures type safety
export enum PlaceholderType {
	PASTE = 'paste',
	FILE = 'file',
	RESOURCE = 'resource',
	// Future types can be added here:
	// TEMPLATE = 'template',
	// ENV_VAR = 'env_var',
	// COMMAND_OUTPUT = 'command_output'
}

// Base placeholder content structure
interface BasePlaceholderContent {
	type: PlaceholderType;
	displayText: string; // What shows in the placeholder (e.g., "[Paste #123: 567 chars]")
}

// Specific placeholder types with their own JSON data structures
export interface PastePlaceholderContent extends BasePlaceholderContent {
	type: PlaceholderType.PASTE;
	content: string; // The actual pasted text
	originalSize: number;
	// 'bracketed' is a real paste reported by the terminal (DECSET 2004);
	// the others are heuristic guesses used when the terminal can't.
	detectionMethod?: 'rate' | 'size' | 'multiline' | 'bracketed';
	timestamp?: number; // When the paste occurred
}

interface FilePlaceholderContent extends BasePlaceholderContent {
	type: PlaceholderType.FILE;
	filePath: string; // Absolute or relative path
	content: string; // File contents at time of inclusion
	lastModified?: number; // File modification time
	encoding?: string; // File encoding (utf8, etc.)
	fileSize?: number; // Original file size
	checksum?: string; // For detecting file changes
}

interface ResourcePlaceholderContent extends BasePlaceholderContent {
	type: PlaceholderType.RESOURCE;
	uri: string; // MCP resource URI
	content: string; // Resource contents at time of inclusion
	mimeType?: string; // Resource MIME type
	serverName: string; // MCP server that provided the resource
	resourceName: string; // Human-readable resource name
}

// Union type for all placeholder content types - fully type-safe
export type PlaceholderContent =
	| PastePlaceholderContent
	| FilePlaceholderContent
	| ResourcePlaceholderContent;

// Core data structure for placeholder handling system
export interface InputState {
	// The text visible in the input field, including placeholders.
	// e.g., "Analyze this: [Paste #1234: 567 chars] and compare with [File #5678: config.json]"
	displayValue: string;

	// A dictionary holding the full content and metadata for each placeholder.
	// The key is the ID from the placeholder.
	placeholderContent: Record<string, PlaceholderContent>;
}

export interface SubmittedInputDraft {
	inputState: InputState;
	attachments: ImageAttachment[];
}

export interface RestoredInputDraft extends SubmittedInputDraft {
	id: number;
}
