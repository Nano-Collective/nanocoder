/**
 * UTF-16 code-point boundary helpers for text editing.
 *
 * JavaScript strings index by UTF-16 code unit, so a supplementary character
 * (emoji, rare CJK) spans two units. Treating either unit as a standalone
 * "character" while moving or deleting splits the surrogate pair and leaves
 * an unpaired surrogate in the value, which renders as U+FFFD or garbage.
 *
 * These helpers treat a full code point as the unit of movement and
 * deletion. Grapheme clusters (base + combining marks, ZWJ emoji sequences)
 * are intentionally NOT merged: code-point granularity keeps the change
 * minimal and predictable while guaranteeing no value is ever corrupted.
 */

/**
 * Greatest offset <= `offset` that is not inside a surrogate pair.
 * Use after any computation that may have landed mid-pair.
 */
export function snapToCodePointStart(value: string, offset: number): number {
	if (offset <= 0 || offset >= value.length) return offset;
	// A trail surrogate at `offset` belongs to the pair starting one before.
	const isTrail = isTrailSurrogate(value.charCodeAt(offset));
	const leadBefore = isLeadSurrogate(value.charCodeAt(offset - 1));
	return isTrail && leadBefore ? offset - 1 : offset;
}

/** Offset of the code point starting exactly at `offset - 1` or before. */
export function previousCodePointStart(value: string, offset: number): number {
	const start = snapToCodePointStart(value, offset);
	return start > 0 ? snapToCodePointStart(value, start - 1) : 0;
}

/** Offset just past the code point starting at `offset`. */
export function nextCodePointEnd(value: string, offset: number): number {
	const start = snapToCodePointStart(value, offset);
	if (start >= value.length) return value.length;
	const code = value.codePointAt(start) ?? 0;
	return start + (code > 0xffff ? 2 : 1);
}

const isLeadSurrogate = (code: number): boolean =>
	code >= 0xd800 && code <= 0xdbff;
const isTrailSurrogate = (code: number): boolean =>
	code >= 0xdc00 && code <= 0xdfff;
