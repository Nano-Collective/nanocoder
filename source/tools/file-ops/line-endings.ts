type LineEnding = '\r\n' | '\n';

/**
 * The line ending used by most lines of `content`. Ties and files with no
 * line breaks count as LF.
 */
export function detectLineEnding(content: string): LineEnding {
	const crlf = content.split('\r\n').length - 1;
	const lf = content.split('\n').length - 1 - crlf;
	return crlf > lf ? '\r\n' : '\n';
}

/**
 * Rewrite every line break in `text` (LF or CRLF) as `ending`.
 */
export function toLineEnding(text: string, ending: LineEnding): string {
	const lf = text.replace(/\r\n/g, '\n');
	return ending === '\n' ? lf : lf.replace(/\n/g, '\r\n');
}

/**
 * Fit whole-file content to the line endings of the file it replaces.
 *
 * Models send LF, so writing their content over a CRLF file would turn every
 * line into LF. When the existing file is mostly CRLF, every line break in
 * `content` is written as CRLF, including in content that mixes both. New
 * files (`existing` is null) and LF files get `content` as sent.
 */
export function fitContentToLineEndings(
	existing: string | null,
	content: string,
): string {
	if (existing === null || detectLineEnding(existing) === '\n') {
		return content;
	}
	return toLineEnding(content, '\r\n');
}

/**
 * Fit an edit's search and replacement text to the file's line endings.
 *
 * Models send LF. On a CRLF file that would miss any multi-line match and
 * write LF lines into the file. When the file is mostly CRLF, both strings
 * are converted to CRLF. If only the original LF search text is in the file
 * (an LF region of a mixed file), the edit is left as sent.
 */
export function fitEditToLineEndings(
	fileContent: string,
	oldStr: string,
	newStr: string,
): {oldStr: string; newStr: string} {
	const ending = detectLineEnding(fileContent);
	if (ending === '\n') {
		return {oldStr, newStr};
	}
	const fittedOld = toLineEnding(oldStr, ending);
	if (
		fittedOld !== oldStr &&
		!fileContent.includes(fittedOld) &&
		fileContent.includes(oldStr)
	) {
		return {oldStr, newStr};
	}
	return {oldStr: fittedOld, newStr: toLineEnding(newStr, ending)};
}
