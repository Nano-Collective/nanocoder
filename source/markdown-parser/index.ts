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

// Basic markdown parser for terminal
export function parseMarkdown(
	text: string,
	themeColors: Colors,
	width?: number,
): string {
	// First decode HTML entities
	let result = decodeHtmlEntities(text);

	// Step 1: Parse tables FIRST (before <br> conversion and code extraction)
	// Tables should have plain text only, no markdown formatting
	// Note: We parse tables before converting <br> tags so that multi-line
	// cells don't break the table regex
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

	// Extract code blocks first (```language\ncode\n```)
	result = result.replace(
		/```([a-zA-Z0-9\-+#]+)?\n([\s\S]*?)```/g,
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

	// Extract inline code (`code`)
	result = result.replace(/`([^`]+)`/g, (_match, code: string) => {
		const formatted = chalk.hex(themeColors.tool)(String(code).trim());
		const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
		inlineCodes.push(formatted);
		return placeholder;
	});

	// Step 4: Process markdown formatting (now safe from code interference)
	// Process lists FIRST before italic, since * at start of line is a list, not italic
	// List items (- item or * item or 1. item)
	// Use [ \t]* instead of \s* to avoid consuming newlines before the list
	// Preserve indentation for nested lists
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
	// Require whitespace or line boundaries around asterisks to avoid matching char*ptr
	// Use [^*\n] to prevent matching across lines
	// Only match if content contains at least one letter to avoid matching math like "5 * 3 * 2"
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

	// Step 5: Restore code blocks and inline code from placeholders
	result = result.replace(/__CODE_BLOCK_(\d+)__/g, (_match, index: string) => {
		return codeBlocks[parseInt(index, 10)] || '';
	});
	result = result.replace(/__INLINE_CODE_(\d+)__/g, (_match, index: string) => {
		return inlineCodes[parseInt(index, 10)] || '';
	});

	return result;
}

export type {Colors} from '../types/markdown-parser.js';
// Re-export utilities for convenience
export {decodeHtmlEntities} from './html-entities.js';
export {parseMarkdownTable} from './table-parser.js';
