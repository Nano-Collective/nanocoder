/**
 * Convert `text` to the file's dominant line ending. Models send LF, so an
 * edit against a CRLF file would otherwise never match across lines and
 * would write mixed endings.
 */
export function toFileLineEndings(fileContent: string, text: string): string {
	const crlf = fileContent.split('\r\n').length - 1;
	const lf = fileContent.split('\n').length - 1 - crlf;
	return crlf > lf ? text.replace(/\r?\n/g, '\r\n') : text;
}
