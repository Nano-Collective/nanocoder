import {CACHE_FILE_LIST_TTL_MS} from '@/constants';
import {formatError} from './error-formatter';
import {walkProjectEntries} from './file-search';
import {fuzzyScoreFilePath} from './fuzzy-matching';
import {getLogger} from './logging';

interface FileCompletion {
	path: string; // Relative path from cwd
	displayPath: string; // Shortened for display
	score: number; // Fuzzy match score (higher = better match)
	isDirectory: boolean;
}

// Simple cache for file list
interface FileListCache {
	files: string[];
	timestamp: number;
}

let fileListCache: FileListCache | null = null;

/**
 * Get list of all files in the project (respecting gitignore)
 */
async function getAllFiles(cwd: string): Promise<string[]> {
	// Check cache
	const now = Date.now();
	if (fileListCache && now - fileListCache.timestamp < CACHE_FILE_LIST_TTL_MS) {
		return fileListCache.files;
	}

	try {
		const allFiles: string[] = [];
		await walkProjectEntries(cwd, undefined, entry => {
			if (!entry.isDirectory) {
				allFiles.push(entry.relativePath.replace(/\\/g, '/'));
			}
			return false;
		});

		fileListCache = {
			files: allFiles,
			timestamp: now,
		};

		return allFiles;
	} catch (error) {
		const logger = getLogger();
		logger.error({error: formatError(error)}, 'Failed to list files');
		return [];
	}
}

/**
 * Extract the current @mention being typed at cursor position
 * Returns the mention text and its position in the input
 */
export function getCurrentFileMention(
	input: string,
	cursorPosition?: number,
): {mention: string; startIndex: number; endIndex: number} | null {
	const pos = cursorPosition ?? input.length;

	// Find the last @ before cursor
	let startIndex = -1;
	for (let i = pos - 1; i >= 0; i--) {
		if (input[i] === '@') {
			startIndex = i;
			break;
		}
		// Stop if we hit whitespace (except for path separators)
		if (input[i] === ' ' || input[i] === '\t' || input[i] === '\n') {
			break;
		}
	}

	if (startIndex === -1) {
		return null;
	}

	// Find the end of the mention (next whitespace or end of string)
	let endIndex = pos;
	for (let i = pos; i < input.length; i++) {
		if (
			input[i] === ' ' ||
			input[i] === '\t' ||
			input[i] === '\n' ||
			input[i] === '@'
		) {
			break;
		}
		endIndex = i + 1;
	}

	// Extract mention text (without the @)
	const fullText = input.substring(startIndex, endIndex);
	const mention = fullText.substring(1); // Remove @ prefix

	// Remove line range suffix if present (e.g., ":10-20")
	const mentionWithoutRange = mention.replace(/:\d+(-\d+)?$/, '');

	return {
		mention: mentionWithoutRange,
		startIndex,
		endIndex,
	};
}

/**
 * Get file completions for a partial path
 */
export async function getFileCompletions(
	partialPath: string,
	cwd: string,
	maxResults: number = 20,
): Promise<FileCompletion[]> {
	// Get all files
	const allFiles = await getAllFiles(cwd);

	// Score each file
	const scoredFiles = allFiles
		.map(file => ({
			path: file,
			displayPath: file.length > 50 ? '...' + file.slice(-47) : file,
			score: fuzzyScoreFilePath(file, partialPath),
			isDirectory: false, // We're only listing files, not directories
		}))
		.filter(f => f.score > 0) // Only include matches
		.sort((a, b) => {
			// Sort by score (descending)
			if (b.score !== a.score) {
				return b.score - a.score;
			}
			// If scores are equal, sort alphabetically
			return a.path.localeCompare(b.path);
		})
		.slice(0, maxResults); // Limit results

	return scoredFiles;
}

/**
 * Clear the file list cache (useful for testing or when files change)
 */
export function clearFileListCache(): void {
	fileListCache = null;
}
