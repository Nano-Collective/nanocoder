import {EventEmitter} from 'node:events';

/**
 * SGR mouse reporting (DECSET 1000 + 1006) support for the fullscreen TUI.
 *
 * The terminal reports mouse activity as `ESC [ < B ; x ; y (M|m)`
 * sequences on stdin. Ink's keypress parser doesn't understand them, so
 * they must be stripped before Ink reads stdin — otherwise clicks and
 * wheel ticks leak into the chat input as garbage text. Wheel events
 * (button bit 64) are re-emitted on {@link wheelEvents} for the chat
 * viewport to consume; every other mouse event is silently dropped.
 */

export type WheelDirection = 'up' | 'down';

/** Singleton bus: cli.tsx publishes wheel ticks, ChatHistory subscribes. */
export const wheelEvents = new EventEmitter();

// ESC [ < button ; column ; row, terminated by M (press) or m (release).
const SGR_MOUSE_RE = /\x1b\[<(\d+);\d+;\d+[Mm]/g;

// Trailing partial mouse sequence cut off at a chunk boundary. Requires
// the full "ESC [ <" prefix: a lone ESC is the Escape KEY and a bare
// "ESC [" starts arrow keys — holding those back would break real input.
// Terminals write mouse sequences atomically, so a split before the "<"
// is not a realistic case.
const MAX_PARTIAL = 20;
const PARTIAL_TAIL_RE = /\x1b\[<(?:\d+(?:;\d+(?:;\d+)?)?)?$/;

export interface StripResult {
	/** Input with all SGR mouse sequences removed. */
	clean: string;
	/** Wheel ticks found, in order. */
	wheel: WheelDirection[];
	/**
	 * Trailing bytes that might be the start of a mouse sequence split
	 * across chunks — prepend to the next chunk before stripping again.
	 */
	carry: string;
}

/**
 * Remove SGR mouse sequences from a stdin chunk, extracting wheel ticks.
 * Pass the previous call's `carry` as `prefix` so sequences split across
 * chunk boundaries are still recognized.
 */
export function stripMouseSequences(chunk: string, prefix = ''): StripResult {
	const input = prefix + chunk;
	const wheel: WheelDirection[] = [];

	let clean = input.replace(SGR_MOUSE_RE, (_match, buttonStr: string) => {
		const button = Number(buttonStr);
		// Bit 64 marks wheel events; low two bits pick the direction.
		if (button & 64) {
			const direction = button & 1 ? 'down' : 'up';
			wheel.push(direction);
		}
		return '';
	});

	// Hold back a trailing partial sequence for the next chunk. Only a
	// short tail can be a genuine partial — longer means it's not a mouse
	// sequence, so let it through rather than swallowing user input.
	let carry = '';
	const partial = clean.match(PARTIAL_TAIL_RE);
	if (partial && partial[0].length > 0 && partial[0].length <= MAX_PARTIAL) {
		carry = partial[0];
		clean = clean.slice(0, clean.length - carry.length);
	}

	return {clean, wheel, carry};
}
