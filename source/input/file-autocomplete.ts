import {CACHE_FILE_LIST_TTL_MS} from '@/constants';
import {formatError} from '../utils/error-formatter';
import {walkProjectEntries} from '../utils/fs/file-search';
import {fuzzyScoreFilePath} from '../utils/fuzzy-matching';
import {getLogger} from '../utils/logging';

export interface FileCompletion {
	path: string; // Relative path from cwd
	displayPath: string; // Shortened for display
	score: number; // Fuzzy match score (higher = better match)
	isDirectory: boolean;
}

export interface ProjectEntryItem {
	path: string;
	isDirectory: boolean;
}

// Simple cache for entries list
interface EntriesCache {
	entries: ProjectEntryItem[];
	timestamp: number;
}

let entriesCache: EntriesCache | null = null;

/**
 * Get list of all entries (files and directories) in the project (respecting gitignore)
 */
export async function getAllEntries(cwd: string): Promise<ProjectEntryItem[]> {
	// Check cache
	const now = Date.now();
	if (entriesCache && now - entriesCache.timestamp < CACHE_FILE_LIST_TTL_MS) {
		return entriesCache.entries;
	}

	try {
		const allEntries: ProjectEntryItem[] = [];
		await walkProjectEntries(
			cwd,
			undefined,
			entry => {
				const normalized = entry.relativePath.replace(/\\/g, '/');
				if (entry.isDirectory) {
					allEntries.push({
						path: normalized.endsWith('/') ? normalized : `${normalized}/`,
						isDirectory: true,
					});
				} else {
					allEntries.push({
						path: normalized,
						isDirectory: false,
					});
				}
				return false;
			},
			{includeDirectories: true},
		);

		entriesCache = {
			entries: allEntries,
			timestamp: now,
		};

		return allEntries;
	} catch (error) {
		const logger = getLogger();
		logger.error({error: formatError(error)}, 'Failed to list entries');
		return [];
	}
}

/**
 * Get list of all files in the project (respecting gitignore)
 */
export async function getAllFiles(cwd: string): Promise<string[]> {
	const entries = await getAllEntries(cwd);
	return entries.filter(e => !e.isDirectory).map(e => e.path);
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
 * Get file and directory completions for a partial path
 */
export async function getFileCompletions(
	partialPath: string,
	cwd: string,
	maxResults: number = 20,
): Promise<FileCompletion[]> {
	// Get all entries (files and directories)
	const allEntries = await getAllEntries(cwd);

	// Score each entry
	const scoredEntries = allEntries
		.map(entry => ({
			path: entry.path,
			displayPath:
				entry.path.length > 50 ? '...' + entry.path.slice(-47) : entry.path,
			score: fuzzyScoreFilePath(entry.path, partialPath),
			isDirectory: entry.isDirectory,
		}))
		.filter(f => f.score > 0) // Only include matches
		.sort((a, b) => {
			// Sort by score (descending)
			if (b.score !== a.score) {
				return b.score - a.score;
			}
			// When scores are tied, prefer files over directories
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? 1 : -1;
			}
			// If scores and types are equal, sort alphabetically
			return a.path.localeCompare(b.path);
		})
		.slice(0, maxResults); // Limit results

	return scoredEntries;
}

/**
 * Clear the file list cache (useful for testing or when files change)
 */
export function clearFileListCache(): void {
	entriesCache = null;
}
