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

const BLOCK_SEPARATOR_OPEN = `\n\n${TURN_CONTEXT_OPEN_TAG}`;

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
 * anything re-reads a stored message as if it were user input: re-submitting
 * it raw would both double-wrap the block and search for skills using the
 * previous turn's context as part of the query.
 *
 * Only a block at the very end of the message, set off by the blank line
 * `appendTurnContext` writes, is removed. A tag the user typed or pasted
 * earlier in their own text is their text and is left alone.
 *
 * The stored and re-sent content keeps its block: that is what preserves the
 * cache.
 */
export function stripTurnContext(content: string): string {
	if (!content.includes(TURN_CONTEXT_OPEN_TAG)) {
		return content;
	}
	let current = content;
	for (;;) {
		const next = stripTrailingBlock(current);
		if (next === null) {
			return current === content ? content : current.trimEnd();
		}
		current = next;
	}
}

function stripTrailingBlock(content: string): string | null {
	const text = content.trimEnd();
	if (text.endsWith(TURN_CONTEXT_CLOSE_TAG)) {
		const body = text.slice(0, -TURN_CONTEXT_CLOSE_TAG.length);
		const start = body.lastIndexOf(`${BLOCK_SEPARATOR_OPEN}\n`);
		if (start >= 0) {
			return body.slice(0, start);
		}
		return body.startsWith(`${TURN_CONTEXT_OPEN_TAG}\n`) ? '' : null;
	}

	// Mechanical compaction can cut a stored block short, leaving an opening
	// tag with no close.
	const start = text.lastIndexOf(BLOCK_SEPARATOR_OPEN);
	if (start >= 0) {
		const rest = text.slice(start + BLOCK_SEPARATOR_OPEN.length);
		if (
			(rest === '' || rest.startsWith('\n')) &&
			!rest.includes(TURN_CONTEXT_CLOSE_TAG)
		) {
			return text.slice(0, start);
		}
		return null;
	}
	const bareStart = text.startsWith(TURN_CONTEXT_OPEN_TAG);
	if (bareStart) {
		const rest = text.slice(TURN_CONTEXT_OPEN_TAG.length);
		if (
			(rest === '' || rest.startsWith('\n')) &&
			!rest.includes(TURN_CONTEXT_CLOSE_TAG)
		) {
			return '';
		}
	}
	return null;
}
