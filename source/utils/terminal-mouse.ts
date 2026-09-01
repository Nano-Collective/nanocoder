import {EventEmitter} from 'node:events';
import {StringDecoder} from 'node:string_decoder';

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

/** DECSET 1000 (button tracking) + 1006 (SGR encoding). */
export const MOUSE_REPORTING_ON = '\x1b[?1000h\x1b[?1006h';
const MOUSE_REPORTING_OFF = '\x1b[?1006l\x1b[?1000l';

/**
 * Selection mode: mouse reporting turned off on request so the terminal
 * handles click-drag itself again.
 *
 * Button tracking is what lets the fullscreen viewport scroll, but it
 * also takes click-drag away from the terminal, so text can't be
 * selected with the mouse. Suspending reporting hands selection back for
 * as long as the user needs it. Inline mode never enables reporting in
 * the first place, so the toggle is a no-op there.
 */
let mouseReportingAvailable = false;
let selectionMode = false;

/** Called by cli.tsx once mouse reporting is actually on. */
export function markMouseReportingAvailable(): void {
	mouseReportingAvailable = true;
}

/** True while mouse reporting is suspended for text selection. */
export function isSelectionMode(): boolean {
	return selectionMode;
}

/**
 * Flip selection mode. Returns false (and changes nothing) when there is
 * no mouse reporting to suspend, so callers can let the key fall through
 * to whatever else might want it.
 */
export function toggleSelectionMode(): boolean {
	if (!mouseReportingAvailable) {
		return false;
	}
	selectionMode = !selectionMode;
	process.stdout.write(
		selectionMode ? MOUSE_REPORTING_OFF : MOUSE_REPORTING_ON,
	);
	return true;
}

/**
 * Decode stdin bytes without losing a multibyte character split across
 * separate data events. TTY input is usually delivered as Buffers, and the
 * default Buffer#toString('utf8') replaces an incomplete trailing sequence
 * immediately instead of waiting for the next chunk.
 */
export function createUtf8InputDecoder(): (chunk: Buffer | string) => string {
	const decoder = new StringDecoder('utf8');

	return chunk =>
		decoder.write(
			typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk,
		);
}

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
