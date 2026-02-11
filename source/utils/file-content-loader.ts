import {readFile, stat} from 'node:fs/promises';
import {extname, resolve} from 'node:path';
import {BINARY_FILE_EXTENSIONS, MAX_FILE_TAG_SIZE_BYTES} from '@/constants.js';

interface FileContentResult {
	success: boolean;
	content?: string;
	error?: string;
	metadata: {
		path: string;
		absolutePath: string;
		size: number;
		lineCount: number;
		lineRange?: {start: number; end?: number};
		tokens: number;
	};
}

/**
 * Load file content with optional line range
 * Silently handles errors - returns success: false instead of throwing
 */
export async function loadFileContent(
	filePath: string,
	lineRange?: {start: number; end?: number},
): Promise<FileContentResult> {
	try {
		const absPath = resolve(filePath);

		// Check if file exists and get stats
		const fileStats = await stat(absPath);

		// Check if it's a file (not directory)
		if (!fileStats.isFile()) {
			return {
				success: false,
				error: 'Path is not a file',
				metadata: {
					path: filePath,
					absolutePath: absPath,
					size: 0,
					lineCount: 0,
					lineRange,
					tokens: 0,
				},
			};
		}

		// Binary extension check
		const ext = extname(absPath).toLowerCase();
		if (BINARY_FILE_EXTENSIONS.has(ext)) {
			const fileType = ext.slice(1).toUpperCase();
			const metadataContent = [
				`[Binary file: ${filePath}]`,
				`Type: ${fileType}`,
				`Size: ${fileStats.size.toLocaleString()} bytes (${formatBytes(fileStats.size)})`,
				`Last Modified: ${fileStats.mtime.toISOString()}`,
				'',
				'(Binary files cannot be included as text content)',
			].join('\n');

			return {
				success: true,
				content: metadataContent,
				metadata: {
					path: filePath,
					absolutePath: absPath,
					size: fileStats.size,
					lineCount: 0,
					lineRange,
					tokens: Math.ceil(metadataContent.length / 4),
				},
			};
		}

		// Size check
		if (fileStats.size > MAX_FILE_TAG_SIZE_BYTES && !lineRange) {
			const estimatedLines = Math.round(fileStats.size / 40);
			const metadataContent = [
				`[Large file: ${filePath}]`,
				`Size: ${fileStats.size.toLocaleString()} bytes (${formatBytes(fileStats.size)})`,
				`Lines: ~${estimatedLines.toLocaleString()}`,
				`Last Modified: ${fileStats.mtime.toISOString()}`,
				'',
				`(File exceeds ${formatBytes(MAX_FILE_TAG_SIZE_BYTES)} limit for inline tagging. Use @file:1-100 to tag specific line ranges)`,
			].join('\n');

			return {
				success: true,
				content: metadataContent,
				metadata: {
					path: filePath,
					absolutePath: absPath,
					size: fileStats.size,
					lineCount: 0,
					lineRange,
					tokens: Math.ceil(metadataContent.length / 4),
				},
			};
		}

		// Read file content
		let content: string;
		try {
			content = await readFile(absPath, 'utf-8');
		} catch {
			// File might be binary or unreadable
			return {
				success: false,
				error: 'Failed to read file (might be binary)',
				metadata: {
					path: filePath,
					absolutePath: absPath,
					size: fileStats.size,
					lineCount: 0,
					lineRange,
					tokens: 0,
				},
			};
		}

		// Split into lines
		const allLines = content.split('\n');
		const totalLines = allLines.length;

		// Extract line range if specified
		let selectedLines: string[];
		let actualLineRange: {start: number; end?: number} | undefined;

		if (lineRange) {
			const start = Math.max(1, lineRange.start);
			const end = lineRange.end ? Math.min(totalLines, lineRange.end) : start;

			// Validate range
			if (start > totalLines) {
				// Invalid range, return empty
				selectedLines = [];
			} else {
				// Arrays are 0-indexed, but line numbers are 1-indexed
				selectedLines = allLines.slice(start - 1, end);
				actualLineRange = {start, end: lineRange.end ? end : undefined};
			}
		} else {
			// No line range, use all lines
			selectedLines = allLines;
		}

		// Format with path header (no line numbers)
		const formattedContent = formatFileContent(selectedLines, filePath);

		// Calculate metadata
		const size = content.length;
		const tokens = Math.ceil(formattedContent.length / 4); // Rough token estimate

		return {
			success: true,
			content: formattedContent,
			metadata: {
				path: filePath,
				absolutePath: absPath,
				size,
				lineCount: selectedLines.length,
				lineRange: actualLineRange,
				tokens,
			},
		};
	} catch (error) {
		// File doesn't exist or other error
		const absPath = resolve(filePath);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
			metadata: {
				path: filePath,
				absolutePath: absPath,
				size: 0,
				lineCount: 0,
				lineRange,
				tokens: 0,
			},
		};
	}
}

/**
 * Format file content with path header (no line numbers for clean content-based editing)
 */
function formatFileContent(lines: string[], filePath: string): string {
	return `Path: ${filePath}\n\n${lines.join('\n')}`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
