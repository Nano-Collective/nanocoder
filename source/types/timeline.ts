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
}

export interface TimelineCaptureInput {
	toolCallId: string;
	toolName: string;
	title: string;
	truncateToMessageIndex: number;
	/** Relative paths → UTF-8 before-image, or `null` if the file did not exist (revert deletes it). */
	files: Map<string, string | null>;
}

export interface TimelineRevertResult {
	revertedTo: TimelineEntryMeta;
	filesRestored: string[];
}

export interface TimelineIndex {
	nextSeq: number;
	entries: TimelineIndexEntry[];
}

export interface TimelineIndexEntry extends TimelineEntryMeta {
	/** Files that did not exist before this tool call; revert unlinks them. */
	createdFiles: string[];
}
