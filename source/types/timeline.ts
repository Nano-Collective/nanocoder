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
	/**
	 * The prompt this entry is a rewind point for. Only prompt-level entries
	 * carry it: they are recorded once per user turn instead of once per tool
	 * call, so `/rewind` can list prompts without having to merge a turn's
	 * many tool checkpoints together. Absent on tool-level entries.
	 */
	promptText?: string;
	/**
	 * A stable id on the first message this prompt added (the user message, or
	 * the first MCP history message that preceded it). Compaction and history
	 * trimming move `truncateToMessageIndex`, so the index alone can point at a
	 * different prompt after they run; the id is resolved against the live
	 * messages when the picker opens.
	 */
	messageId?: string;
}

export interface TimelineCaptureInput {
	toolCallId: string;
	toolName: string;
	title: string;
	truncateToMessageIndex: number;
	turnId?: string;
	/** Makes this a `/rewind` point, and allows it to hold no files at all. */
	promptText?: string;
	/** Stable id of the prompt's first message, so a later rewind can find it after compaction. */
	messageId?: string;
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
	/** Paths a restore could not write; the rest were still applied. */
	filesFailed: string[];
}

/** What reverting to an entry would change, for the confirmation prompt. */
export interface TimelineRevertPlan {
	/** Files whose before-image will be written back. */
	restore: string[];
	/** Files the agent created, which will be deleted. */
	remove: string[];
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
