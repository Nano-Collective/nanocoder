import {getProjectRoot} from '@/services/session-cwd';
import {TimelineManager} from '@/services/timeline-manager';
import type {TimelineEntryMeta} from '@/types/timeline';

/**
 * `/rewind`: restore the workspace and the conversation to the state they had
 * just before an earlier prompt.
 *
 * The storage is the action timeline, which already keeps per-session
 * before-images. `/checkpoint` could not do this job: it only exists if the
 * user made one by hand, and it restores files without the messages (#1242).
 * Architect's Revert is the same idea but only covers the last turn of one
 * mode.
 *
 * A turn is recorded as a single entry, taken when the prompt is submitted:
 * every file that was dirty at that moment, plus the message index the prompt
 * starts at. Restoring it puts back the pre-prompt contents (and deletes the
 * files the turn created), and slicing the messages to that index removes the
 * prompt and everything after it.
 *
 * Bash side effects are not undoable this way, which is why the picker says so.
 */

/** One prompt that can be rewound to. */
export interface RewindPoint {
	entry: TimelineEntryMeta;
	promptText: string;
	/** Slice `messages` to this index to drop the prompt and its turns. */
	messageIndex: number;
	files: string[];
}

/** What `/rewind` restores. */
export type RewindMode = 'both' | 'conversation' | 'files';

export interface RecordPromptOptions {
	timeline: TimelineManager;
	/** What the user typed, without the per-turn context block. */
	promptText: string;
	/** `messages.length` before the prompt was appended. */
	messageIndex: number;
	/** Groups the entries of one prompt; only used for display and retries. */
	turnId?: string;
}

const TITLE_MAX_CHARS = 60;

/** First line of the prompt, for the entry's title. */
export function promptTitle(promptText: string): string {
	const firstLine = promptText.split(/\r?\n/, 1)[0]?.trim() ?? '';
	if (firstLine.length <= TITLE_MAX_CHARS) return firstLine;
	return `${firstLine.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

/**
 * Record the state a later `/rewind` returns to.
 *
 * Called before the prompt's first tool runs, so the scan describes the
 * workspace the user was looking at. When the scan cannot answer (no git, or
 * more dirty files than it will list) the point is still recorded, with no
 * files: rewinding the conversation then works, and "restore code" honestly
 * reports that it restored nothing rather than pretending to have undone a
 * workspace it could not read.
 */
export async function recordPromptStart(
	options: RecordPromptOptions,
): Promise<TimelineEntryMeta | null> {
	const {timeline, promptText, messageIndex, turnId} = options;

	const scan = timeline.getModifiedFiles();
	const usable = scan.available && !scan.truncated;

	const files =
		usable && scan.files.length > 0
			? await timeline.snapshotPaths(scan.files)
			: new Map<string, string | null>();

	return timeline.capture({
		toolCallId: `prompt-${messageIndex}`,
		toolName: 'prompt',
		title: promptTitle(promptText),
		truncateToMessageIndex: messageIndex,
		turnId,
		promptText,
		files,
	});
}

/**
 * Record the files the prompt created or changed.
 *
 * The start capture only knows the files that were already dirty, so a file
 * the turn created is invisible to it and a rewind would leave it behind. This
 * second entry covers exactly the paths that were clean (or absent) at prompt
 * start: their before-image is HEAD, or `null` when HEAD has never seen them,
 * which makes the revert delete them. Paths the start entry already recorded
 * are skipped so their uncommitted contents are not replaced with HEAD.
 *
 * Both entries share the prompt's message index, and `revertTo` widens to the
 * whole turn, so one rewind undoes both.
 */
export async function recordPromptEnd(
	options: RecordPromptOptions,
): Promise<TimelineEntryMeta | null> {
	const {timeline, promptText, messageIndex, turnId} = options;

	const scan = timeline.getModifiedFiles();
	if (scan.truncated || !scan.available) {
		return null;
	}

	const entries = await timeline.list();
	const startEntry = entries.find(
		entry =>
			entry.promptText !== undefined &&
			entry.truncateToMessageIndex === messageIndex,
	);
	const recorded = new Set(startEntry?.filesChanged ?? []);

	const files = new Map<string, string | null>();
	for (const filePath of scan.files) {
		const relativePath = timeline.toRelativePath(filePath);
		if (!relativePath || recorded.has(relativePath)) continue;
		if (files.has(relativePath)) continue;

		const head = timeline.readHeadSnapshot(relativePath);
		// A binary before-image is not recorded at all: restoring a corrupt one
		// is worse than leaving the file alone.
		if (head.kind === 'binary') continue;
		files.set(relativePath, head.kind === 'text' ? head.content : null);
	}

	if (files.size === 0) return null;

	return timeline.capture({
		toolCallId: `prompt-end-${messageIndex}`,
		toolName: 'prompt',
		title: promptTitle(promptText),
		truncateToMessageIndex: messageIndex,
		turnId,
		promptText,
		files,
	});
}

/**
 * The recorded prompts, newest first.
 *
 * Only entries that carry a prompt are rewind points; tool-level checkpoints
 * from ACP or from before this feature are ignored, so an old index cannot
 * offer a prompt that was never stored.
 */
export function buildRewindPoints(entries: TimelineEntryMeta[]): RewindPoint[] {
	return entries
		.filter(entry => typeof entry.promptText === 'string')
		.map(entry => ({
			entry,
			promptText: entry.promptText as string,
			messageIndex: entry.truncateToMessageIndex,
			files: entry.filesChanged,
		}))
		.sort(
			(a, b) => b.messageIndex - a.messageIndex || b.entry.seq - a.entry.seq,
		);
}

/** Every point in the session's timeline, newest first. */
export async function listRewindPoints(
	timeline: TimelineManager,
): Promise<RewindPoint[]> {
	return buildRewindPoints(await timeline.list());
}

/**
 * Restore the files a prompt started with, and drop that prompt's timeline
 * entries so they cannot be rewound to twice.
 */
export async function restoreFiles(
	timeline: TimelineManager,
	point: RewindPoint,
): Promise<string[]> {
	const result = await timeline.revertTo(point.entry.id);
	return result.filesRestored;
}

/**
 * Drop the conversation from `point` onward. Slicing `messages` is the
 * caller's job (it owns the array); this only discards the timeline entries
 * that described the discarded turns.
 */
export async function restoreConversation(
	timeline: TimelineManager,
	point: RewindPoint,
): Promise<number> {
	await timeline.truncateAfter(point.messageIndex);
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
