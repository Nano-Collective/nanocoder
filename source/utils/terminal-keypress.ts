/**
 * Ink's keypress parser only splits stdin on ESC. A run of plain control
 * bytes that arrives in one read (key repeat on a held Backspace, a double
 * Ctrl+Z, anything typed while a render is blocking the event loop) reaches
 * the input handlers as ONE event whose `input` is e.g. "\x7f\x7f\x7f". No
 * key binding matches a multi-byte string, so the keys did nothing and the
 * raw bytes were inserted into the prompt and sent to the model.
 *
 * splitControlKeypresses breaks such a chunk into one piece per control key
 * so the caller can hand each to Ink as its own read.
 *
 * Left attached on purpose:
 * - Tab, LF and CR: a multi-line chunk without bracketed paste markers is how
 *   the paste heuristic recognises a paste from a terminal that doesn't
 *   support bracketed paste, so splitting at line breaks would submit it.
 * - A control byte straight after ESC: that is a Meta chord (Alt+Backspace is
 *   "\x1b\x7f"), a single keypress Ink decodes itself.
 */

const isSplittableControl = (code: number): boolean =>
	(code < 0x20 &&
		code !== 0x09 && // Tab
		code !== 0x0a && // LF
		code !== 0x0d && // CR
		code !== 0x1b) || // ESC, which Ink's parser already splits on
	code === 0x7f; // DEL (Backspace on most terminals)

// xterm's modifyOtherKeys=2 encoding of Enter with a modifier — `ESC [27;<m>;13~`
// where <m> is 2 for Shift, 3 for Alt, 5 for Ctrl — which the VS Code integrated
// terminal sends. Ink cannot parse it at all (empty key name) and, since Ink 8,
// drops such unrecognised control sequences before they reach `useInput`. The
// kitty CSI-u form `ESC [13;<m>u` encodes exactly the same key + modifier with
// the same modifier numbering, and Ink parses it natively, so rewrite one into
// the other before the bytes reach Ink.
const XTERM_MODIFIED_ENTER = /\x1b\[27;(\d+);13~/g;

export function rewriteXtermModifiedEnter(text: string): string {
	return text.replaceAll(XTERM_MODIFIED_ENTER, '\x1b[13;$1u');
}

const XTERM_ENTER_PREFIX = '\x1b[27;';
const MAX_PENDING_ENTER_LENGTH = 32;
const ENTER_SEQUENCE_TIMEOUT_MS = 20;

/**
 * Rewrite modified Enter across stdin chunks. Hold only a possible trailing
 * sequence, with a size limit and Ink's 20ms escape timeout so a standalone
 * Escape (or an incomplete/malformed sequence) cannot stay buffered forever.
 * Call after extracting bracketed pastes, whose payloads must remain opaque.
 */
export function createXtermModifiedEnterRewriter(
	onText: (text: string) => void,
) {
	let carry = '';
	let timeout: ReturnType<typeof setTimeout> | undefined;

	return {
		push(chunk: string): void {
			if (!chunk) return;
			clearTimeout(timeout);
			timeout = undefined;
			const text = carry + chunk;
			carry = '';
			const escapeIndex = text.lastIndexOf('\x1b');
			const tail = escapeIndex === -1 ? '' : text.slice(escapeIndex);
			const isPartial =
				tail.length > 0 &&
				tail.length <= MAX_PENDING_ENTER_LENGTH &&
				(XTERM_ENTER_PREFIX.startsWith(tail) ||
					(tail.startsWith(XTERM_ENTER_PREFIX) &&
						/^\d+(?:;(?:1(?:3)?)?)?$/.test(
							tail.slice(XTERM_ENTER_PREFIX.length),
						)));

			const ready = isPartial ? text.slice(0, escapeIndex) : text;
			if (isPartial) {
				carry = tail;
				timeout = setTimeout(() => {
					const pending = carry;
					carry = '';
					timeout = undefined;
					onText(pending);
				}, ENTER_SEQUENCE_TIMEOUT_MS);
				timeout.unref();
			}
			if (ready) onText(rewriteXtermModifiedEnter(ready));
		},
		/**
		 * Emit any held-back partial sequence now, unrewritten — the same
		 * bytes the 20ms timeout would have flushed. Callers use this to
		 * preserve stream order when something else must be emitted
		 * immediately: a bracketed paste that arrives after a held-back tail
		 * must not be reordered ahead of it.
		 */
		flush(): void {
			clearTimeout(timeout);
			timeout = undefined;
			if (!carry) return;
			const pending = carry;
			carry = '';
			onText(pending);
		},
		dispose(): void {
			clearTimeout(timeout);
			timeout = undefined;
			carry = '';
		},
	};
}

export function splitControlKeypresses(text: string): string[] {
	const pieces: string[] = [];
	let current = '';
	for (let i = 0; i < text.length; i++) {
		const char = text[i] as string;
		const code = text.charCodeAt(i);
		if (isSplittableControl(code) && text[i - 1] !== '\x1b') {
			if (current) pieces.push(current);
			pieces.push(char);
			current = '';
		} else {
			current += char;
		}
	}
	if (current) pieces.push(current);
	return pieces;
}
