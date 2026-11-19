/**
 * Metadata for a single action-timeline checkpoint (no file contents).
 * One entry is recorded immediately before each workspace-mutating tool call.
 */
export interface TimelineEntryMeta {
	id: string;
	seq: number;
	toolCallId: string;
	toolName: string;
	title: string;
	timestamp: string;
	/** Slice `messages` to this index (exclusive) so the assistant tool_calls turn is dropped. */
	truncateToMessageIndex: number;
	filesChanged: string[];
	/** The entries of `filesChanged` that did not exist before this tool call; revert unlinks them. */
	createdFiles: string[];
	/**
	 * Identifies the user prompt whose turn made this tool call. Every checkpoint
	 * of one prompt shares it, however many model round-trips the prompt took
	 * (`truncateToMessageIndex` moves on with each round-trip, so it cannot group
	 * them). Absent on checkpoints recorded before this field existed.
	 */
	turnId?: string;
}

export interface TimelineCaptureInput {
	toolCallId: string;
	toolName: string;
	title: string;
	truncateToMessageIndex: number;
	turnId?: string;
	/** Relative paths → UTF-8 before-image, or `null` if the file did not exist (revert deletes it). */
	files: Map<string, string | null>;
}

/** Result of scanning the workspace for dirty files ahead of an opaque capture. */
export interface TimelineScanResult {
	files: string[];
	/** The scan hit its file cap, so it is not a complete picture. */
	truncated: boolean;
	/** How many files the cap dropped. */
	truncatedCount: number;
	/** False when git could not answer at all. */
	available: boolean;
}

export interface TimelineRevertResult {
	revertedTo: TimelineEntryMeta;
	filesRestored: string[];
}

export interface TimelineIndex {
	nextSeq: number;
	entries: TimelineIndexEntry[];
}

export type TimelineIndexEntry = TimelineEntryMeta;

/** What a checkpoint holds for one path, as a client reads it back. */
export type TimelineBeforeImage =
	| {kind: 'text'; content: string}
	| {kind: 'created'}
	| {kind: 'unavailable'; reason: string};
