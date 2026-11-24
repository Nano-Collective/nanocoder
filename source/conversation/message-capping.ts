import {resolve} from 'node:path';
import {getSafeSessionCwd} from '@/services/session-cwd';
import {
	forgetReadContentRange,
	forgetVisibilityReceipt,
	isReadStub,
} from '@/tools/runtime/read-tracker';
import type {Message, ToolCall} from '@/types/core';

type ReadRange = {path: string; startLine?: number; endLine?: number};

/** Tools whose call leaves the file content the model wrote in its context. */
const EDIT_TOOLS = new Set(['write_file', 'string_replace', 'diff_edit']);

function optionalLine(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined;
}

/**
 * The path + range of every read_file result in `messages` that carries the
 * file body (not a stub, which only points at an earlier body, and not a
 * metadata_only read, which shows the file's size and type but no content).
 */
function readBodies(
	messages: Message[],
	calls: Map<string, ToolCall>,
): Map<string, ReadRange> {
	const bodies = new Map<string, ReadRange>();
	for (const message of messages) {
		if (message.role !== 'tool' || !message.tool_call_id) continue;
		const call = calls.get(message.tool_call_id);
		if ((message.name ?? call?.function.name) !== 'read_file') continue;
		if (isReadStub(message.content)) continue;
		const args = call?.function.arguments;
		if (typeof args?.path !== 'string') continue;
		if (args.metadata_only === true) continue;
		const range: ReadRange = {
			path: resolve(getSafeSessionCwd(), args.path),
			startLine: optionalLine(args.start_line),
			endLine: optionalLine(args.end_line),
		};
		bodies.set(
			`${range.path}\0${range.startLine ?? ''}\0${range.endLine ?? ''}`,
			range,
		);
	}
	return bodies;
}

/**
 * Paths the model wrote or edited in `messages`. The edit call carries the
 * content it wrote, so the receipt that edit recorded is still backed by
 * what the model sees.
 */
function editedPaths(messages: Message[]): Set<string> {
	const paths = new Set<string>();
	for (const message of messages) {
		for (const call of message.tool_calls ?? []) {
			if (!EDIT_TOOLS.has(call.function.name)) continue;
			const path = call.function.arguments?.path;
			if (typeof path === 'string') {
				paths.add(resolve(getSafeSessionCwd(), path));
			}
		}
	}
	return paths;
}

/**
 * read_file answers a repeat read with an "unchanged since last read" stub,
 * which is only true while the earlier body is still in what the model sees.
 * When the cap drops that body, forget its stub entry so the next read
 * returns the content again. Bodies still present in the kept window (a
 * fresh re-read) keep their entry, so a long capped session does not lose
 * every stub each turn the way a global generation bump would.
 *
 * The same holds for the read-before-edit guard: a visibility receipt says
 * the model has seen those lines, which stops being true once the body is
 * dropped. A file with nothing left in the kept window that shows its
 * content (a read body, or the model's own write or edit of it) loses its
 * receipt, so the edit tools ask for a fresh read instead of allowing a
 * blind edit.
 */
function forgetDroppedReadBodies(dropped: Message[], kept: Message[]): void {
	const calls = new Map<string, ToolCall>();
	for (const message of [...dropped, ...kept]) {
		for (const call of message.tool_calls ?? []) {
			calls.set(call.id, call);
		}
	}
	const keptBodies = readBodies(kept, calls);
	const stillVisible = editedPaths(kept);
	for (const range of keptBodies.values()) {
		stillVisible.add(range.path);
	}
	for (const [key, range] of readBodies(dropped, calls)) {
		if (!keptBodies.has(key)) {
			forgetReadContentRange(range.path, range.startLine, range.endLine);
		}
		// The model can no longer see this read. Unless the messages still
		// sent show the file's content another way, its lines must stop
		// counting as seen, or the edit tools would allow a blind edit.
		if (!stillVisible.has(range.path)) {
			forgetVisibilityReceipt(range.path);
		}
	}
}

/**
 * Caps the message history sent to the model to at most `maxMessages` messages.
 * Avoids orphaning tool calls/results by snapping the slice boundary to complete turns.
 *
 * Specifically:
 * - If the boundary lands on or within a sequence of tool results, we walk the start
 *   index backwards to include the initiating `assistant` message and all its associated
 *   tool results.
 * - read_file stub entries whose body is dropped are forgotten, and so are the
 *   visibility receipts of files whose content is no longer shown in the kept
 *   window (see `forgetDroppedReadBodies`).
 */
export function capMessagesForModel(
	messages: Message[],
	maxMessages: number,
): Message[] {
	if (messages.length <= maxMessages) {
		return messages;
	}

	let start = messages.length - maxMessages;

	// Walk back to avoid starting in the middle of a tool-call sequence.
	// If the boundary lands on a 'tool' role message, walk backward to find the
	// initiating assistant message.
	while (start > 0 && messages[start]?.role === 'tool') {
		start--;
	}

	forgetDroppedReadBodies(messages.slice(0, start), messages.slice(start));
	return messages.slice(start);
}
