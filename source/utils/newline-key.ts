import type {Key} from 'ink';

/**
 * Shift+Enter and friends, as the sequences terminals actually emit.
 *
 * `\x1b[27;<mods>;13~` is xterm's modifyOtherKeys=2 encoding of Enter with a
 * modifier, which xterm.js (VS Code, and anything embedding it) sends. Ink's
 * keypress parser does not recognise it at all — `name` comes back empty — so
 * without this it lands in TextInput's generic insert branch and the literal
 * text `[27;2;13~` ends up in the prompt. Modifier 2 is Shift, 3 is Alt.
 */
const XTERM_MODIFIED_ENTER = /^\x1b\[27;[23];13~$/;

/**
 * True when a keypress means "insert a newline" rather than "submit".
 *
 * Shared by `UserInput` (which must not submit on these) and `TextInput`
 * (which does the actual insertion at the cursor). Both components see every
 * keystroke through their own `useInput`, so the two sides have to agree
 * exactly — hence one predicate rather than a condition duplicated in each.
 *
 * Recognised, with the terminal that produces each:
 * - a literal LF, from Ctrl+J or a `sendSequence`-style keybinding bound to `\n`
 * - Ctrl+J reported as a modified letter, which is how it arrives under the
 *   kitty keyboard protocol
 * - Enter with Shift, the kitty / CSI-u encoding (`\x1b[13;2u`)
 * - Enter with Meta, i.e. ESC+CR (`\x1b\r`) — Option+Enter on macOS, and the
 *   sequence terminals are conventionally configured to send for Shift+Enter
 * - Enter with Shift or Alt in xterm's modifyOtherKeys form
 *
 * Bare Shift+Enter is deliberately absent: most terminals send it as a plain
 * `\r`, byte-identical to Enter, so it cannot be told apart from submit. Those
 * terminals need a keybinding (or the kitty protocol) to send one of the above.
 */
export function isNewlineKey(input: string, key: Key): boolean {
	if (input === '\n' && !key.return) {
		return true;
	}

	if (key.ctrl && input === 'j') {
		return true;
	}

	if (key.return && (key.shift || key.meta)) {
		return true;
	}

	return XTERM_MODIFIED_ENTER.test(key.raw ?? '');
}
