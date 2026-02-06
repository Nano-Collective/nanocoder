import chalk from 'chalk';
import Table from 'cli-table3';
import {DEFAULT_TERMINAL_WIDTH, TABLE_COLUMN_MIN_WIDTH} from '@/constants';
import type {Colors} from '../types/markdown-parser';
import {stripMarkdown} from './utils';

// Parse markdown tables using cli-table3
export function parseMarkdownTable(
	tableText: string,
	themeColors: Colors,
	width?: number,
): string {
	const lines = tableText.trim().split('\n');
	if (lines.length < 2) return tableText;

	// Extract rows
	const rows = lines.map(line =>
		line
			.split('|')
			.map(cell => cell.trim())
			.filter(cell => cell.length > 0),
	);

	// Check if second row is separator (e.g., |---|---|)
	const separatorRow = rows[1];
	const isSeparator = separatorRow?.every(cell => /^:?-+:?$/.test(cell));
	if (!isSeparator || rows.length < 3) return tableText;

	// Helper to clean cell content - remove all markdown and HTML
	const cleanCell = (text: string): string => {
		let result = text;
		// Remove inline code backticks (extract the content)
		result = result.replace(/`([^`]+)`/g, '$1');
		// Remove HTML tags
		result = result.replace(/<[^>]+>/g, '');
		// Strip markdown formatting (bold, italic, links)
		result = stripMarkdown(result);
		return result.trim();
	};

	// Extract header and data rows - clean all content
	const header = rows[0].map(cell => cleanCell(cell));
	const dataRows = rows.slice(2).map(row => row.map(cell => cleanCell(cell)));

	// Calculate widths from cleaned content
	const headerWidths = header.map(cell => cell.length);
	const dataWidths = dataRows.map(row => row.map(cell => cell.length));

	// Calculate column widths properly
	const terminalWidth =
		width || process.stdout.columns || DEFAULT_TERMINAL_WIDTH;
	const numCols = header.length;

	// Get max content width for each column
	const contentWidths = headerWidths.map((headerWidth, colIdx) => {
		let maxWidth = headerWidth;
		for (const rowWidths of dataWidths) {
			if (rowWidths[colIdx]) {
				maxWidth = Math.max(maxWidth, rowWidths[colIdx]);
			}
		}
		return maxWidth;
	});

	// Calculate available width (accounting for borders and padding)
	const borderWidth = numCols + 1; // vertical bars
	const paddingWidth = numCols * 2; // 1 space on each side of each column
	const availableWidth = terminalWidth - borderWidth - paddingWidth;

	// Distribute width proportionally
	const totalContentWidth = contentWidths.reduce((a, b) => a + b, 0);
	const colWidths = contentWidths.map(width =>
		Math.max(
			TABLE_COLUMN_MIN_WIDTH,
			Math.floor((width / totalContentWidth) * availableWidth),
		),
	);

	// Create table with cli-table3 - full borders, proper alignment
	const table = new Table({
		head: header.map(cell => chalk.hex(themeColors.primary).bold(cell)),
		colWidths: colWidths,
		style: {
			head: [], // Don't apply default styles, we're using chalk
			border: ['gray'], // Subtle border color
			'padding-left': 1,
			'padding-right': 1,
		},
		chars: {
			top: '─',
			'top-mid': '┬',
			'top-left': '┌',
			'top-right': '┐',
			bottom: '─',
			'bottom-mid': '┴',
			'bottom-left': '└',
			'bottom-right': '┘',
			left: '│',
			'left-mid': '├',
			mid: '─',
			'mid-mid': '┼',
			right: '│',
			'right-mid': '┤',
			middle: '│',
		},
		wordWrap: true,
		wrapOnWordBoundary: true,
	});

	// Add data rows - don't style them, let cli-table3 handle layout
	for (const row of dataRows) {
		table.push(row);
	}

	return table.toString();
}
