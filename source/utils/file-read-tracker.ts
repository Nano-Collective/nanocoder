import {resolve} from 'node:path';

/**
 * Tracks which files have been read in the most recent tool call.
 * This is used to enforce that files must be read immediately before they can be edited.
 */
class FileReadTracker {
	private lastReadFiles: Set<string> = new Set();

	/**
	 * Mark a file as having been read in the current tool call
	 * @param path - The file path (will be normalized to absolute path)
	 */
	markAsRead(path: string): void {
		const absPath = resolve(path);
		this.lastReadFiles.add(absPath);
	}

	/**
	 * Check if a file was read in the most recent tool call
	 * @param path - The file path to check
	 * @returns true if the file was read in the last tool call
	 */
	wasReadInLastToolCall(path: string): boolean {
		const absPath = resolve(path);
		return this.lastReadFiles.has(absPath);
	}

	/**
	 * Clear the last read files (called before each new tool call to reset state)
	 * This ensures only files read in the immediate previous tool call are tracked
	 */
	clearLastToolCall(): void {
		this.lastReadFiles.clear();
	}

	/**
	 * Clear all tracked reads (useful when clearing conversation history)
	 */
	clear(): void {
		this.lastReadFiles.clear();
	}

	/**
	 * Get all tracked file paths from last tool call (for debugging)
	 */
	getLastReadFiles(): string[] {
		return Array.from(this.lastReadFiles);
	}
}

// Export a singleton instance
export const fileReadTracker = new FileReadTracker();
