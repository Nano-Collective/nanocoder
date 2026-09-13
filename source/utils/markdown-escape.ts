/**
 * Escapes characters in a string so that they are treated as literal text
 * rather than Markdown syntax.
 * This helps prevent issues where dynamic content breaks formatting or results
 * in unwanted autolinking/spoofing.
 *
 * @param text The plain text to escape.
 * @returns The escaped text, safe for inclusion inside standard Markdown text nodes.
 */
export function escapeMarkdown(text: string): string {
	// Escape common markdown meta-characters:
	// \ * _ ` [ ] < > # | ~
	return text.replace(/([\\*_`\[\]<>#|~])/g, '\\$1');
}
