import {resolve} from 'node:path';

/**
 * Session-scoped read-before-edit tracker.
 *
 * Small/local models frequently edit or overwrite files they have not actually
 * looked at, producing hallucinated `old_str` content or blind clobbering of a
 * file's existing contents. Forcing a Read before an Edit (and before
 * overwriting an existing file) turns that failure into a cheap, self-correcting
 * recovery path: the tool refuses, the model reads, then retries with content
 * that matches.
 *
 * The tracker records absolute paths the agent has either read (via read_file)
 * or written (via write_file / string_replace) during the process lifetime.
 * Writing counts as "seen" because the model just produced the content, so a
 * follow-up edit to the same file is not blind.
 *
 * State is intentionally global (not per-conversation): it errs toward
 * UNDER-enforcement across agents/subagents, which is safe — the worst case is
 * that a guard fails to fire. Over-enforcement (blocking a legitimate edit) is
 * the only outcome we must avoid, and `string_replace`'s exact-match validator
 * remains the backstop for stale reads.
 */
const seenFiles = new Set<string>();

/** Record that a file's contents have been seen this session (read or written). */
export function markFileSeen(absPath: string): void {
	seenFiles.add(resolve(absPath));
}

/** Whether a file's contents have been seen this session. */
export function hasSeenFile(absPath: string): boolean {
	return seenFiles.has(resolve(absPath));
}

/** Clear all tracked files. Called on /clear and exposed for tests. */
export function clearReadTracker(): void {
	seenFiles.clear();
}
