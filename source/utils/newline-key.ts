import type {Key} from 'ink';

// Keep #1670's raw-sequence fallback for callers outside the CLI proxy.
const XTERM_MODIFIED_ENTER = /^\x1b\[27;[23];13~$/;

/**
 * True when a keypress means "insert a newline" rather than "submit".
 * `raw` is the byte sequence behind the keypress (see `useRawInput`); stock
 * Ink does not put it on `Key`.
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
 * - Enter with Shift or Meta (Alt) — the kitty / CSI-u encoding
 *   (`\x1b[13;2u`, `\x1b[13;3u`) and ESC+CR (`\x1b\r`, Option+Enter on macOS).
 *   The xterm modifyOtherKeys form (`\x1b[27;2;13~`, sent by the VS Code
 *   integrated terminal) is rewritten into the CSI-u form by the stdin proxy
 *   in cli.tsx before the bytes reach Ink. The raw-sequence fallback remains
 *   for callers that do not use that proxy.
 *
 * Bare Shift+Enter is deliberately absent: most terminals send it as a plain
 * `\r`, byte-identical to Enter, so it cannot be told apart from submit. Those
 * terminals need a keybinding (or the kitty protocol) to send one of the above.
 */
export function isNewlineKey(input: string, key: Key, raw = ''): boolean {
	if (input === '\n' && !key.return) {
		return true;
	}

	if (key.ctrl && input === 'j') {
		return true;
	}

	if (key.return && (key.shift || key.meta)) {
		return true;
	}

	return XTERM_MODIFIED_ENTER.test(raw);
}
