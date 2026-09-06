import {EventEmitter} from 'node:events';

/**
 * Bracketed paste (DECSET 2004) support.
 *
 * Without bracketed paste mode the terminal delivers a paste as plain
 * bytes, so the CR at every line break reaches Ink's keypress parser as
 * Enter and the input submits partway through the paste. Enabling 2004
 * makes the terminal wrap the payload in `ESC [ 200~` / `ESC [ 201~`, so
 * it can be lifted out of the stream before Ink ever sees it and handed
 * to the input as a single paste.
 *
 * The payload is opaque: it is never scanned for mouse sequences or key
 * bindings, which is the whole point — pasted text that happens to look
 * like an escape sequence stays text.
 */

/** Enable / disable sequences for bracketed paste mode. */
export const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
export const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/**
 * Guard against an unterminated paste growing without bound (a terminal
 * that sends the start marker and then dies, say). A payload past this
 * size is flushed as-is and accumulation restarts.
 */
const MAX_PASTE_CHARS = 10_000_000;

/**
 * Shortest partial start marker worth holding back between chunks.
 *
 * A lone `ESC` is the Escape KEY and a bare `ESC [` starts the arrow
 * keys, so treating either as a possible paste marker would swallow real
 * keystrokes until the next byte arrived. `ESC [ 2` is unambiguous
 * enough, and terminals write the markers atomically, so a split earlier
 * than that is not a realistic case. Inside a payload the same guard is
 * not needed (and must not apply): nothing there is a keystroke, so
 * every partial end marker is held back.
 */
const MIN_PARTIAL_START = 3;

/** Singleton bus: cli.tsx publishes payloads, UserInput subscribes. */
export const pasteEvents = new EventEmitter();

/**
 * Length of the longest suffix of `text` that is a proper prefix of
 * `marker`, i.e. how many trailing bytes might be a marker split across
 * a chunk boundary and must be held back for the next chunk.
 */
function partialMarkerLength(text: string, marker: string): number {
	const max = Math.min(text.length, marker.length - 1);
	for (let length = max; length > 0; length--) {
		if (text.endsWith(marker.slice(0, length))) {
			return length;
		}
	}
	return 0;
}

export interface PasteSplit {
	/** Input with every bracketed paste (markers and payload) removed. */
	clean: string;
	/** Complete paste payloads found in this chunk, in order. */
	pastes: string[];
}

/**
 * Build a stateful splitter that lifts bracketed pastes out of a stdin
 * stream. Pastes routinely span several chunks, so the returned function
 * keeps the in-progress payload and any partial marker between calls.
 */
export function createPasteExtractor(): (chunk: string) => PasteSplit {
	let inPaste = false;
	let payload = '';
	let carry = '';

	return (chunk: string): PasteSplit => {
		let rest = carry + chunk;
		carry = '';
		let clean = '';
		const pastes: string[] = [];

		while (rest.length > 0) {
			if (inPaste) {
				const end = rest.indexOf(PASTE_END);
				if (end === -1) {
					// No terminator yet. Buffer everything except a trailing
					// fragment that could be the start of the end marker.
					const partial = partialMarkerLength(rest, PASTE_END);
					payload += rest.slice(0, rest.length - partial);
					carry = rest.slice(rest.length - partial);
					if (payload.length > MAX_PASTE_CHARS) {
						pastes.push(payload);
						payload = '';
					}
					break;
				}
				payload += rest.slice(0, end);
				pastes.push(payload);
				payload = '';
				inPaste = false;
				rest = rest.slice(end + PASTE_END.length);
				continue;
			}

			const start = rest.indexOf(PASTE_START);
			if (start === -1) {
				const found = partialMarkerLength(rest, PASTE_START);
				const partial = found >= MIN_PARTIAL_START ? found : 0;
				clean += rest.slice(0, rest.length - partial);
				carry = rest.slice(rest.length - partial);
				break;
			}
			clean += rest.slice(0, start);
			inPaste = true;
			rest = rest.slice(start + PASTE_START.length);
		}

		return {clean, pastes};
	};
}
