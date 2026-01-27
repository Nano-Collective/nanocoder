import {extname} from 'node:path';
import {FILE_EXTENSION_TO_LANGUAGE} from '@/constants';
import type {FileNode} from '@/utils/file-tree';

/**
 * Get all file paths within a directory node recursively
 */
export function getAllFilesInDirectory(node: FileNode): string[] {
	const files: string[] = [];
	if (!node.isDirectory) {
		files.push(node.path);
	} else if (node.children) {
		for (const child of node.children) {
			files.push(...getAllFilesInDirectory(child));
		}
	}
	return files;
}

/**
 * Get the highlight.js language name from a file path
 */
export function getLanguageFromPath(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	const basename = filePath.split('/').pop()?.toLowerCase() ?? '';

	// Check for special filenames
	if (basename === 'dockerfile') return 'dockerfile';
	if (basename === 'makefile') return 'makefile';

	return FILE_EXTENSION_TO_LANGUAGE[ext] ?? 'plaintext';
}

/**
 * Format token count for display (e.g., 1500 -> "1.5k")
 */
export function formatTokens(tokens: number): string {
	if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
	if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
	return String(tokens);
}

/**
 * Format file size for display
 */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
