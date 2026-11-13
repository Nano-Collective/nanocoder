export interface TruncateTextOptions {
	/**
	 * Appended when the text is cut, and counted toward `max`. Default `'…'`;
	 * pass `''` for a hard cut.
	 */
	ellipsis?: string;
	/**
	 * What `max` counts. `'code-points'` (default) counts characters, so an
	 * emoji is one; `'code-units'` counts UTF-16 units like `String.length`,
	 * so an emoji is two. Either way the cut never splits a surrogate pair.
	 *
	 * Neither is terminal width: for column-accurate cuts use cli-truncate or
	 * `truncateAnsi`.
	 */
	unit?: 'code-points' | 'code-units';
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/**
 * Shorten `text` to at most `max` units, ending with `ellipsis` when it was
 * cut. Text that already fits is returned unchanged. When `max` leaves no
 * room for the ellipsis beside any content, the text is hard-cut instead.
 */
export function truncateText(
	text: string,
	max: number,
	{ellipsis = '…', unit = 'code-points'}: TruncateTextOptions = {},
): string {
	const codePoints = unit === 'code-points' ? Array.from(text) : null;
	const length = codePoints ? codePoints.length : text.length;
	if (length <= max) return text;
	if (max <= 0) return '';

	const ellipsisLength = codePoints
		? Array.from(ellipsis).length
		: ellipsis.length;
	const room = max > ellipsisLength ? max - ellipsisLength : max;
	const suffix = max > ellipsisLength ? ellipsis : '';

	if (codePoints) return codePoints.slice(0, room).join('') + suffix;

	// Back off one unit rather than leave half of a surrogate pair.
	const end = isHighSurrogate(text.charCodeAt(room - 1)) ? room - 1 : room;
	return text.slice(0, end) + suffix;
}
