import chalk from 'chalk';
import {highlight} from 'cli-highlight';
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

// Internal helper: run all markdown processing but leave __CODE_BLOCK_N__ markers
// in place so callers can decide how to handle code blocks independently.
function _parseMarkdownCore(
	text: string,
	themeColors: Colors,
	width?: number,
): {text: string; codeBlocks: string[]; inlineCodes: string[]} {
	// First decode HTML entities
	let result = decodeHtmlEntities(text);

	// Step 1: Parse tables FIRST (before <br> conversion and code extraction)
	result = result.replace(
		/(?:^|\n)((?:\|.+\|\n)+)/gm,
		(_match, tableText: string) => {
			return '\n' + parseMarkdownTable(tableText, themeColors, width) + '\n';
		},
	);

	// Step 2: Convert <br> and <br/> tags to newlines (AFTER table parsing)
	result = result.replace(/<br\s*\/?>/gi, '\n');

	// Step 3: Extract and protect code blocks and inline code with placeholders
	const codeBlocks: string[] = [];
	const inlineCodes: string[] = [];

	// Extract fenced code blocks (```language\ncode\n```) — also handles
	// the case where there is no language tag and the opening fence is immediately
	// followed by a newline (``` \n code \n ```). Both fences must sit at the
	// start of a line so fences nested inside a blockquote (`> \`\`\``) are not
	// extracted as copyable code.
	result = result.replace(
		/^```([a-zA-Z0-9\-+#]+)?\n([\s\S]*?)^```/gm,
		(_match, lang: string | undefined, code: string) => {
			try {
				// Convert tabs to 2 spaces to prevent terminal rendering at 8-space width
				const codeStr = String(code).trim().replace(/\t/g, '  ');
				// Apply syntax highlighting with detected language
				const highlighted = highlight(codeStr, {
					language: lang || 'plaintext',
					theme: 'default',
				});
				const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
				codeBlocks.push(highlighted);
				return placeholder;
			} catch {
				// Fallback to plain colored text if highlighting fails
				const formatted = chalk.hex(themeColors.tool)(
					String(code).trim().replace(/\t/g, '  '),
				);
				const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
				codeBlocks.push(formatted);
				return placeholder;
			}
		},
	);

	// Extract inline code (`code`) — single-line only, so stray backticks from
	// unextracted fenced blocks (e.g. inside a blockquote) don't form a span.
	result = result.replace(/`([^`\n]+)`/g, (_match, code: string) => {
		const formatted = chalk.hex(themeColors.tool)(String(code).trim());
		const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
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

	return {text: result, codeBlocks, inlineCodes};
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
	} = _parseMarkdownCore(text, themeColors, width);
	let result = processed;
	result = result.replace(/__CODE_BLOCK_(\d+)__/g, (_match, index: string) => {
		return codeBlocks[parseInt(index, 10)] || '';
	});
	result = result.replace(/__INLINE_CODE_(\d+)__/g, (_match, index: string) => {
		return inlineCodes[parseInt(index, 10)] || '';
	});
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
	} = _parseMarkdownCore(text, themeColors, width);

	// Restore inline code inside text segments (they stay with the text)
	const withInline = processed.replace(
		/__INLINE_CODE_(\d+)__/g,
		(_match, index: string) => inlineCodes[parseInt(index, 10)] || '',
	);

	// Split on code block markers; split() with a capture group interleaves
	// text and index strings: [text, idx, text, idx, ...]
	const segments = withInline.split(/__CODE_BLOCK_(\d+)__/);
	const parts: MarkdownPart[] = [];

	for (let i = 0; i < segments.length; i++) {
		if (i % 2 === 0) {
			// Even indices are text segments
			const content = segments[i];
			if (content) parts.push({type: 'text', content});
		} else {
			// Odd indices are captured code block indices
			const idx = parseInt(segments[i] ?? '0', 10);
			const codeContent = codeBlocks[idx];
			if (codeContent) parts.push({type: 'code', content: codeContent});
		}
	}

	return parts;
}

export type {Colors} from '../types/markdown-parser.js';
// Re-export utilities for convenience
export {decodeHtmlEntities} from './html-entities.js';
export {parseMarkdownTable} from './table-parser.js';
