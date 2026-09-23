import wrapAnsi from 'wrap-ansi';

/**
 * Ink uses wrap-ansi with trim: false, which preserves the space at word
 * boundaries as leading whitespace on continuation lines. This function
 * wraps each original line individually and trims only the artifact spaces
 * from continuation lines, preserving intentional indentation.
 */
export function wrapWithTrimmedContinuations(
	text: string,
	width: number,
): string {
	if (width <= 0) return text;
	const originalLines = text.split('\n');
	const result: string[] = [];

	for (const line of originalLines) {
		if (line === '') {
			result.push('');
			continue;
		}
		const wrapped = wrapAnsi(line, width, {trim: false, hard: true});
		const subLines = wrapped.split('\n');

		result.push(subLines[0] ?? '');

		for (let i = 1; i < subLines.length; i++) {
			// Trim the leading space that is a word-wrap artifact.
			// Handle ANSI escape codes that may precede the space.
			// Keep the space when it carries the inverse-video cursor —
			// stripping it would leave an empty inverse span (invisible cursor).
			result.push(
				(subLines[i] ?? '').replace(
					/^((?:\x1b\[[0-9;]*m)*)\s/,
					(match, codes: string) => (codes.includes('\x1b[7m') ? match : codes),
				),
			);
		}
	}

	return result.join('\n');
}

export type VisualLineSegment = {
	/** Offset in the original value of this visual line's first character */
	start: number;
	/** Number of characters on this visual line */
	length: number;
};

/**
 * Compute the visual lines an input value renders as: logical lines (split on
 * \n) further soft-wrapped at `width` the same way the display path wraps them
 * (wrap-ansi, trim: false, hard: true). A single logical line longer than the
 * terminal width therefore yields multiple segments — this is what lets cursor
 * navigation treat text-wrapped prompts as multiline even without any \n.
 *
 * Without a positive width, segments are just the logical lines.
 */
export function getVisualLineSegments(
	value: string,
	width?: number,
): VisualLineSegment[] {
	const segments: VisualLineSegment[] = [];
	let offset = 0;

	for (const line of value.split('\n')) {
		if (!width || width <= 0 || line.length === 0) {
			segments.push({start: offset, length: line.length});
		} else {
			const wrapped = wrapAnsi(line, width, {trim: false, hard: true});
			if (wrapped.replaceAll('\n', '') === line) {
				// Lossless wrap (only \n insertions): sub-line lengths map 1:1
				// onto consecutive slices of the original line.
				let subStart = offset;
				for (const sub of wrapped.split('\n')) {
					segments.push({start: subStart, length: sub.length});
					subStart += sub.length;
				}
			} else {
				// Defensive fallback if wrap-ansi ever mutates content:
				// fixed-width slices so offsets stay valid.
				for (let i = 0; i < line.length; i += width) {
					segments.push({
						start: offset + i,
						length: Math.min(width, line.length - i),
					});
				}
			}
		}

		offset += line.length + 1;
	}

	return segments;
}

/**
 * Move a cursor offset one visual line up or down, preserving the column
 * where possible (clamped to the target line's length).
 *
 * Returns the new offset, or null when the cursor is already on the first
 * (up) / last (down) visual line — the caller falls back to history
 * navigation in that case.
 */
export function moveCursorToVisualLine(
	segments: VisualLineSegment[],
	cursorOffset: number,
	direction: 'up' | 'down',
): number | null {
	let row = segments.length - 1;
	for (let i = 0; i < segments.length; i++) {
		const end = segments[i].start + segments[i].length;
		if (cursorOffset < end) {
			row = i;
			break;
		}
		if (cursorOffset === end) {
			// At a soft-wrap boundary the same offset is both this row's end and
			// the next row's start; the renderer shows the cursor at the start of
			// the next row, so it belongs there. At a \n boundary (gap of 1) the
			// cursor sits on the newline at this row's end.
			const next = segments[i + 1];
			if (!next || next.start > end) {
				row = i;
				break;
			}
		}
	}

	const targetRow = direction === 'up' ? row - 1 : row + 1;
	if (targetRow < 0 || targetRow >= segments.length) {
		return null;
	}

	const col = cursorOffset - segments[row].start;
	const target = segments[targetRow];
	return target.start + Math.min(col, target.length);
}
