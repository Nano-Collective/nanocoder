import {resolve} from 'node:path';
import {
	getContainedSessionCwd,
	getSafeSessionCwd,
} from '@/services/session-cwd';
import {
	forgetReadContentRange,
	forgetVisibilityReceipt,
	isReadStub,
} from '@/tools/runtime/read-tracker';
import type {Message, ToolCall} from '@/types/core';

type ReadRange = {path: string; startLine?: number; endLine?: number};

/**
 * Tools whose successful call leaves the file content the model wrote in its
 * context, with the start of the result each one returns on success.
 */
const EDIT_SUCCESS = new Map<string, RegExp>([
	['write_file', /^File (?:written|overwritten) successfully/],
	['string_replace', /^Successfully replaced content/],
	['diff_edit', /^Successfully applied /],
]);

/** A search_file_contents match line: `file:line:content` or `file:line-`. */
const SEARCH_MATCH_LINE = /^(.+?):\d+[:-]/;

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
 * Paths the model wrote or edited in `messages`, counting only calls whose
 * result reports success. The call carries the content it wrote, so the
 * receipt that edit recorded is still backed by what the model sees. A failed
 * or declined call wrote nothing and shows nothing of the file.
 */
function editedPaths(
	messages: Message[],
	calls: Map<string, ToolCall>,
): Set<string> {
	const paths = new Set<string>();
	for (const message of messages) {
		if (message.role !== 'tool' || !message.tool_call_id) continue;
		const call = calls.get(message.tool_call_id);
		if (!call) continue;
		const success = EDIT_SUCCESS.get(call.function.name);
		if (!success?.test(message.content)) continue;
		const path = call.function.arguments?.path;
		if (typeof path === 'string') {
			paths.add(resolve(getSafeSessionCwd(), path));
		}
	}
	return paths;
}

/**
 * Paths that search_file_contents results in `messages` show lines of. The
 * tool prints each match as `file:line:content` (or `file:line-` with
 * context), with `file` relative to the directory it searched.
 */
function searchedPaths(
	messages: Message[],
	calls: Map<string, ToolCall>,
): Set<string> {
	const paths = new Set<string>();
	for (const message of messages) {
		if (message.role !== 'tool' || !message.tool_call_id) continue;
		const call = calls.get(message.tool_call_id);
		const name = message.name ?? call?.function.name;
		if (name !== 'search_file_contents') continue;
		if (!message.content.startsWith('Found ')) continue;
		for (const line of message.content.split('\n')) {
			const match = SEARCH_MATCH_LINE.exec(line);
			if (match?.[1]) {
				paths.add(resolve(getContainedSessionCwd(), match[1]));
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
 * content (a read body, a search result that matched it, or the model's own
 * successful write or edit of it) loses its receipt, so the edit tools ask
 * for a fresh read instead of allowing a blind edit.
 */
function forgetDroppedReadBodies(dropped: Message[], kept: Message[]): void {
	const calls = new Map<string, ToolCall>();
	for (const message of [...dropped, ...kept]) {
		for (const call of message.tool_calls ?? []) {
			calls.set(call.id, call);
		}
	}
	const keptBodies = readBodies(kept, calls);
	const stillVisible = new Set([
		...editedPaths(kept, calls),
		...searchedPaths(kept, calls),
	]);
	for (const range of keptBodies.values()) {
		stillVisible.add(range.path);
	}
	for (const [key, range] of readBodies(dropped, calls)) {
		if (!keptBodies.has(key)) {
			forgetReadContentRange(range.path, range.startLine, range.endLine);
		}
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
