import {getProjectRoot} from '@/services/session-cwd';
import {TimelineManager} from '@/services/timeline-manager';
import type {Message} from '@/types/core';
import type {
	TimelineEntryMeta,
	TimelineRevertPlan,
	TimelineRevertResult,
} from '@/types/timeline';

/**
 * `/rewind`: restore the workspace and the conversation to the state they had
 * just before an earlier prompt.
 *
 * A prompt is recorded as a marker entry with no files of its own. The files
 * come from the per-tool checkpoints the timeline already takes before each
 * mutating tool call, which is the only set that describes what the agent
 * actually changed: snapshotting every dirty file at prompt boundaries also
 * captured the user's own edits and files created while a turn ran, and a
 * rewind then wrote those back or deleted them.
 *
 * Restoring a marker reverts every checkpoint from that prompt onward, so a
 * rewind undoes the chosen prompt and everything after it. Bash side effects
 * outside the workspace are not undoable this way, which is why the picker
 * says so.
 */

/** One prompt that can be rewound to. */
export interface RewindPoint {
	entry: TimelineEntryMeta;
	promptText: string;
	/** Slice `messages` to this index to drop the prompt and its turns. */
	messageIndex: number;
	/** Files a rewind restores to their before-image. */
	files: string[];
	/** Files the agent created, which a rewind deletes. */
	createdFiles: string[];
}

/** What `/rewind` restores. */
export type RewindMode = 'both' | 'conversation' | 'files';

export interface RecordPromptOptions {
	timeline: TimelineManager;
	/** What the user typed, without the per-turn context block. */
	promptText: string;
	/** `messages.length` before the prompt was appended. */
	messageIndex: number;
	/** Groups the marker with the tool checkpoints of the same prompt. */
	turnId?: string;
	/** Stable id on the user message, resolved again when the picker opens. */
	messageId?: string;
}

const TITLE_MAX_CHARS = 60;

/** First line of the prompt, for the entry's title. */
export function promptTitle(promptText: string): string {
	const firstLine = promptText.split(/\r?\n/, 1)[0]?.trim() ?? '';
	if (firstLine.length <= TITLE_MAX_CHARS) return firstLine;
	return `${firstLine.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

/**
 * Record the point a later `/rewind` returns to.
 *
 * Called before the prompt is sent, so its position in `messages` is exactly
 * the boundary a rewind slices to. The marker carries no files: the tool
 * checkpoints recorded while the turn runs supply those.
 */
export async function recordPromptStart(
	options: RecordPromptOptions,
): Promise<TimelineEntryMeta | null> {
	const {timeline, promptText, messageIndex, turnId, messageId} = options;

	return timeline.capture({
		toolCallId: `prompt-${messageId ?? messageIndex}`,
		toolName: 'prompt',
		title: promptTitle(promptText),
		truncateToMessageIndex: messageIndex,
		turnId,
		promptText,
		messageId,
		files: new Map<string, string | null>(),
	});
}

/**
 * Classify the paths a revert from `startEntry` onward would touch.
 *
 * Oldest first: `revertTo` applies entries newest-first, so the earliest
 * before-image is the one left on disk.
 */
function describeEntries(
	entries: TimelineEntryMeta[],
	startIndex: number,
): Pick<RewindPoint, 'files' | 'createdFiles'> {
	const files: string[] = [];
	const createdFiles: string[] = [];
	const classified = new Set<string>();

	for (const entry of entries.slice(startIndex)) {
		const created = new Set(entry.createdFiles);
		for (const filePath of entry.filesChanged) {
			if (classified.has(filePath)) continue;
			classified.add(filePath);
			if (created.has(filePath)) {
				createdFiles.push(filePath);
			} else {
				files.push(filePath);
			}
		}
	}

	return {files, createdFiles};
}

/**
 * The recorded prompts, newest first.
 *
 * Only entries that carry a prompt are rewind points; tool-level checkpoints
 * from ACP or from before this feature are ignored. When `messages` is given
 * (the live conversation), points are resolved by their stable message id and
 * a point whose message compaction removed is dropped: its stored index would
 * otherwise match an unrelated prompt. Without `messages`, the stored index is
 * used as-is (tests and callers that only have the timeline).
 */
export function buildRewindPoints(
	entries: TimelineEntryMeta[],
	messages?: Message[],
): RewindPoint[] {
	const messageIndexById = messages
		? new Map(
				messages.flatMap((message, index) =>
					message.id === undefined ? [] : [[message.id, index] as const],
				),
			)
		: null;

	const points: RewindPoint[] = [];

	for (const [position, entry] of entries.entries()) {
		if (typeof entry.promptText !== 'string') continue;

		let messageIndex = entry.truncateToMessageIndex;
		if (messages) {
			if (!entry.messageId) continue;
			const resolved = messageIndexById?.get(entry.messageId);
			if (resolved === undefined) continue;
			messageIndex = resolved;
		}

		points.push({
			entry,
			promptText: entry.promptText,
			messageIndex,
			...describeEntries(entries, position),
		});
	}

	return points.sort(
		(a, b) => b.messageIndex - a.messageIndex || b.entry.seq - a.entry.seq,
	);
}

/** Every point in the session's timeline, newest first. */
export async function listRewindPoints(
	timeline: TimelineManager,
	messages?: Message[],
): Promise<RewindPoint[]> {
	return buildRewindPoints(await timeline.list(), messages);
}

/** What restoring `point` would write and delete, for the confirmation prompt. */
export async function planRewind(
	timeline: TimelineManager,
	point: RewindPoint,
): Promise<TimelineRevertPlan> {
	return timeline.describeRevert(point.entry.id);
}

/**
 * Restore the before-images of every tool checkpoint from `point` onward, and
 * drop those entries so they cannot be rewound to twice. `filesFailed` reports
 * writes that did not land; the others were still applied.
 */
export async function restoreFiles(
	timeline: TimelineManager,
	point: RewindPoint,
): Promise<TimelineRevertResult> {
	return timeline.revertTo(point.entry.id);
}

/**
 * Drop the conversation from `point` onward. Truncation is keyed by the
 * entry's position, not a message index, so compaction cannot make it remove
 * a different prompt's entries.
 */
export async function restoreConversation(
	timeline: TimelineManager,
	point: RewindPoint,
): Promise<number> {
	await timeline.truncateFrom(point.entry.id);
	return point.messageIndex;
}

/** The messages that remain after rewinding to `point`. */
export function messagesAfterRewind<T>(messages: T[], point: RewindPoint): T[] {
	return messages.slice(0, Math.max(0, point.messageIndex));
}

/**
 * The session's timeline, cached per session id so the recorder and `/rewind`
 * share one in-memory index. Returns null where no timeline can be built
 * (invalid id, read-only workspace): rewind is then simply unavailable rather
 * than failing every prompt.
 */
const timelines = new Map<string, TimelineManager>();

export function getSessionTimeline(
	sessionId: string,
	workspaceRoot: string = getProjectRoot(),
): TimelineManager | null {
	const cached = timelines.get(sessionId);
	if (cached) return cached;
	try {
		const manager = new TimelineManager(workspaceRoot, sessionId);
		timelines.set(sessionId, manager);
		return manager;
	} catch {
		return null;
	}
}
