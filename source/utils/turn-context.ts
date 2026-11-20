/**
 * Per-turn context carried inside the user's own message (#1574).
 *
 * Skills matched for a request and memories recalled for it used to be
 * appended to the system prompt, which made the system block — the part every
 * chat template renders ahead of the tool schemas and the whole conversation —
 * differ on every turn. Local backends only reuse their KV cache for the
 * byte-identical prefix of a request, so that cost a full prefill each turn.
 *
 * Carrying the block at the end of the user message instead keeps the system
 * block stable for the session and leaves history append-only: nothing already
 * sent is ever rewritten, so a turn only adds to the cached prefix. It is
 * appended rather than prepended because every history predicate in the
 * codebase matches on `content.startsWith(...)` (see `isAutoDiagnosticsMessage`,
 * `isInternalWalkthroughMessage`) and session titles derive from the opening of
 * the first user message.
 */

const TURN_CONTEXT_OPEN_TAG = '<turn-context>';
const TURN_CONTEXT_CLOSE_TAG = '</turn-context>';

/**
 * Matches one whole context block, including the blank line that separates it
 * from the user's text. Non-greedy so several blocks in one string (a
 * compacted or hand-edited message) are removed individually rather than
 * swallowing everything between the first and last.
 */
const TURN_CONTEXT_BLOCK = /\n*<turn-context>\n[\s\S]*?\n<\/turn-context>/gu;

/**
 * An opening tag whose block runs to the end of the string. Mechanical
 * compaction truncates a long user message mid-content, so a stored block can
 * lose its closing tag; without this, the remains would survive every strip
 * and be shown to the user forever. Applied only after the well-formed pass,
 * so it can never eat a later complete block.
 */
const TRUNCATED_TURN_CONTEXT_BLOCK = /\n*<turn-context>(\n[\s\S]*)?$/u;

/**
 * Append the turn's context sections to the user's message.
 *
 * Returns `message` untouched when there is nothing to add, so a turn with no
 * relevant skills and no recalled memories is byte-identical to one built
 * before this existed.
 */
export function appendTurnContext(
	message: string,
	sections: readonly (string | undefined | null)[],
): string {
	const present = sections
		.map(section => section?.trim())
		.filter((section): section is string => !!section);
	if (present.length === 0) {
		return message;
	}
	const body = present.join('\n\n');
	const block = `${TURN_CONTEXT_OPEN_TAG}\n${body}\n${TURN_CONTEXT_CLOSE_TAG}`;
	// An empty user message (an image-only turn) must not gain a leading blank
	// line, which would otherwise shift every byte of the block.
	return message ? `${message}\n\n${block}` : block;
}

/**
 * Strip context blocks, leaving the text the user actually typed.
 *
 * Used for display (replayed history, exports, the ACP timeline) and before
 * anything re-reads a stored message as if it were user input — re-submitting
 * it raw would both double-wrap the block and search for skills using the
 * previous turn's context as part of the query.
 *
 * The stored and re-sent content keeps its block: that is what preserves the
 * cache.
 */
export function stripTurnContext(content: string): string {
	if (!content.includes(TURN_CONTEXT_OPEN_TAG)) {
		return content;
	}
	return content
		.replaceAll(TURN_CONTEXT_BLOCK, '')
		.replace(TRUNCATED_TURN_CONTEXT_BLOCK, '')
		.trimEnd();
}
