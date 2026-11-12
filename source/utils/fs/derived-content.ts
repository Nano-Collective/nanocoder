import {extname} from 'node:path';

/**
 * Formats the read path cannot reproduce, only transcribe.
 *
 * Reading one of these yields a markdown transcript produced by conversion,
 * never the file's own bytes, so the read and write sides must agree on exactly
 * which extensions they cover. Both consult this module rather than keeping
 * their own list, so they cannot drift apart as formats are added.
 */
const DERIVED_CONTENT_EXTENSIONS = new Set(['.pdf', '.docx']);

/**
 * True when reading `path` yields a derived markdown transcript instead of the
 * file's own content.
 */
export function isDerivedContentPath(path: string): boolean {
	return DERIVED_CONTENT_EXTENSIONS.has(extname(path).toLowerCase());
}
