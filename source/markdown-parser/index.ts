import chalk from 'chalk';
import {highlight} from 'cli-highlight';
import {getSyntaxTheme} from '@/config/themes';
import type {Colors} from '../types/markdown-parser.js';
import {decodeHtmlEntities} from './html-entities.js';
import {parseMarkdownTable} from './table-parser.js';

// Helper function to get compatible color from theme (handles both old and new naming)
function _getColor(themeColors: Colors, colorProperty: keyof Colors): string {
	const color = themeColors[colorProperty];
	return color || '#ffffff'; // fallback to white
}

export type MarkdownPart =
	| {type: 'text'; content: string}
	| {type: 'code'; content: string};

// Choose a marker prefix that cannot occur in the decoded source text. Each
// parse call is synchronous and restores its markers before returning, so the
// same namespace can be reused by a later call.
function _getPlaceholderPrefixes(text: string): {
	codePrefix: string;
	inlinePrefix: string;
} {
	let namespace = 0;
	let namespacePrefix = `__NANOCODER_MD_${namespace}__`;
	while (text.includes(namespacePrefix)) {
		namespace += 1;
		namespacePrefix = `__NANOCODER_MD_${namespace}__`;
	}
	return {
		codePrefix: `${namespacePrefix}CODE_BLOCK_`,
		inlinePrefix: `${namespacePrefix}INLINE_CODE_`,
	};
}

// Internal helper: run all markdown processing but leave namespaced markers
// in place so callers can decide how to handle code blocks independently.
function _parseMarkdownCore(
	text: string,
	themeColors: Colors,
	width?: number,
): {
	text: string;
	codeBlocks: string[];
	inlineCodes: string[];
	codeMarkers: string[];
	inlineMarkers: string[];
} {
	// Pick markers against decoded input while keeping fenced code untouched
	// until after its placeholders have been inserted.
	const decodedSource = decodeHtmlEntities(text);
	const {codePrefix, inlinePrefix} = _getPlaceholderPrefixes(decodedSource);

	// Initialize markdown processing
	let result = text;

	const codeBlocks: string[] = [];
	const inlineCodes: string[] = [];
	const codeMarkers: string[] = [];
	const inlineMarkers: string[] = [];

	// Extract and protect fenced code blocks BEFORE HTML processing
	result = result.replace(
		/^([ \t]*)```([a-zA-Z0-9\-+#]+)?\n([\s\S]*?)^\1```/gm,
		(_match, indent: string, lang: string | undefined, code: string) => {
			const dedented = indent
				? code
						.split('\n')
						.map(line =>
							line.startsWith(indent) ? line.slice(indent.length) : line,
						)
						.join('\n')
				: code;
			try {
				// Convert tabs to 2 spaces to prevent terminal rendering at 8-space width
				const codeStr = dedented.trim().replace(/\t/g, '  ');
				// Apply syntax highlighting with detected language
				const highlighted = highlight(codeStr, {
					language: lang || 'plaintext',
					theme: getSyntaxTheme(themeColors),
				});
				const placeholder = `${codePrefix}${codeBlocks.length}__`;
				codeMarkers.push(placeholder);
				codeBlocks.push(highlighted);
				return placeholder;
			} catch {
				// Fallback to plain colored text if highlighting fails
				const formatted = chalk.hex(themeColors.tool)(
					dedented.trim().replace(/\t/g, '  '),
				);
				const placeholder = `${codePrefix}${codeBlocks.length}__`;
				codeMarkers.push(placeholder);
				codeBlocks.push(formatted);
				return placeholder;
			}
		},
	);

	// Decode HTML entities AFTER code blocks are protected
	result = decodeHtmlEntities(result);

	// Parse tables
	result = result.replace(
		/(?:^|\n)((?:\|.+\|[ \t]*(?:\n|(?![\s\S])))+)/gm,
		(_match, tableText: string) => {
			return '\n' + parseMarkdownTable(tableText, themeColors, width) + '\n';
		},
	);

	// Convert <br> and <br/> tags to newlines (AFTER table parsing)
	result = result.replace(/<br\s*\/?>/gi, '\n');
	// Extract inline code (`code`) — single-line only, so stray backticks from
	// unextracted fenced blocks (e.g. inside a blockquote) don't form a span.
	result = result.replace(/`([^`\n]+)`/g, (_match, code: string) => {
		const formatted = chalk.hex(themeColors.tool)(String(code).trim());
		const placeholder = `${inlinePrefix}${inlineCodes.length}__`;
		inlineMarkers.push(placeholder);
		inlineCodes.push(formatted);
		return placeholder;
	});

	// Step 4: Process markdown formatting (now safe from code interference)
	// Process lists FIRST before italic, since * at start of line is a list, not italic
	result = result.replace(/^([ \t]*)[-*]\s+(.+)$/gm, (_match, indent, text) => {
		return indent + chalk.hex(themeColors.text)(`• ${text}`);
	});
	result = result.replace(
		/^([ \t]*)(\d+)\.\s+(.+)$/gm,
		(_match, indent, num, text) => {
			return indent + chalk.hex(themeColors.text)(`${num}. ${text}`);
		},
	);

	// Bold (**text** only - avoid __ to prevent conflicts with snake_case)
	result = result.replace(/\*\*([^*]+)\*\*/g, (_match, text) => {
		return chalk.hex(themeColors.text).bold(text);
	});

	// Italic (*text* only - avoid _ to prevent conflicts with snake_case)
	result = result.replace(
		/(^|\s)\*([^*\n]*[a-zA-Z][^*\n]*)\*($|\s)/gm,
		(_match, before, text, after) => {
			return before + chalk.hex(themeColors.text).italic(text) + after;
		},
	);

	// Headings (# Heading)
	result = result.replace(/^(#{1,6})\s+(.+)$/gm, (_match, _hashes, text) => {
		return chalk.hex(themeColors.primary).bold(text);
	});

	// Links [text](url)
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
		return (
			chalk.hex(themeColors.info).underline(text) +
			' ' +
			chalk.hex(themeColors.secondary)(`(${url})`)
		);
	});

	// Blockquotes (> text)
	result = result.replace(/^>\s+(.+)$/gm, (_match, text) => {
		return chalk.hex(themeColors.secondary).italic(`> ${text}`);
	});

	return {text: result, codeBlocks, inlineCodes, codeMarkers, inlineMarkers};
}

function _replaceMarkers(
	text: string,
	markers: string[],
	values: string[],
): string {
	let result = '';
	let cursor = 0;
	for (const [index, marker] of markers.entries()) {
		const markerIndex = text.indexOf(marker, cursor);
		if (markerIndex === -1) continue;

		result += text.slice(cursor, markerIndex);
		result += values[index] ?? '';
		cursor = markerIndex + marker.length;
	}
	return result + text.slice(cursor);
}

// Basic markdown parser for terminal — returns a single flat string
export function parseMarkdown(
	text: string,
	themeColors: Colors,
	width?: number,
): string {
	const {
		text: processed,
		codeBlocks,
		inlineCodes,
		codeMarkers,
		inlineMarkers,
	} = _parseMarkdownCore(text, themeColors, width);
	let result = _replaceMarkers(processed, codeMarkers, codeBlocks);
	result = _replaceMarkers(result, inlineMarkers, inlineCodes);
	return result;
}

// Structured parser — returns text and fenced code blocks as separate parts
// so the UI can render them differently (e.g. code without a left border).
export function parseMarkdownParts(
	text: string,
	themeColors: Colors,
	width?: number,
): MarkdownPart[] {
	const {
		text: processed,
		codeBlocks,
		inlineCodes,
		codeMarkers,
		inlineMarkers,
	} = _parseMarkdownCore(text, themeColors, width);

	// Restore inline code inside text segments (they stay with the text)
	const withInline = _replaceMarkers(processed, inlineMarkers, inlineCodes);
	const parts: MarkdownPart[] = [];
	let cursor = 0;

	for (const [index, marker] of codeMarkers.entries()) {
		const markerIndex = withInline.indexOf(marker, cursor);
		if (markerIndex === -1) continue;

		const textContent = withInline.slice(cursor, markerIndex);
		if (textContent) parts.push({type: 'text', content: textContent});

		const codeContent = codeBlocks[index];
		if (codeContent) parts.push({type: 'code', content: codeContent});

		cursor = markerIndex + marker.length;
	}

	const trailingText = withInline.slice(cursor);
	if (trailingText) parts.push({type: 'text', content: trailingText});

	return parts;
}

export type {Colors} from '../types/markdown-parser.js';
// Re-export utilities for convenience
export {decodeHtmlEntities} from './html-entities.js';
export {parseMarkdownTable} from './table-parser.js';
