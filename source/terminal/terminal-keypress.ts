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
