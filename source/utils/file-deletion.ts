import {lstat, readdir, rmdir, unlink} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * Shared deletion utilities for rm and rmdir tools
 */

/**
 * Delete a file
 */
export async function deleteFile(
	absPath: string,
	force: boolean = false,
): Promise<void> {
	try {
		await unlink(absPath);
	} catch (error: unknown) {
		if (
			force &&
			error instanceof Error &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			// File doesn't exist - ignore if force=true
			return;
		}
		throw error;
	}
}

/**
 * Delete a directory recursively
 */
export async function deleteDirectory(
	absPath: string,
	force: boolean = false,
): Promise<void> {
	try {
		// First, recursively delete all contents
		const items = await readdir(absPath);
		for (const item of items) {
			const itemPath = join(absPath, item);
			const stats = await lstat(itemPath);

			if (stats.isDirectory()) {
				await deleteDirectory(itemPath, force);
			} else {
				await deleteFile(itemPath, force);
			}
		}

		// Then delete the empty directory
		await rmdir(absPath);
	} catch (error: unknown) {
		if (
			force &&
			error instanceof Error &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			// Directory doesn't exist - ignore if force=true
			return;
		}
		throw error;
	}
}

/**
 * List directory contents for preview
 */
export async function listDirectoryContents(
	absPath: string,
): Promise<string[]> {
	try {
		const items = await readdir(absPath);
		const results: string[] = [];

		for (const item of items) {
			const itemPath = join(absPath, item);
			const stats = await lstat(itemPath);

			if (stats.isDirectory()) {
				results.push(`${item}/`);

				// Recursively list subdirectory contents
				const subItems = await readdir(itemPath);
				results.push(...subItems.map(subItem => `  ${item}/${subItem}`));
			} else {
				results.push(item);
			}
		}

		return results;
	} catch (_error) {
		// If we can't read the directory, return empty array
		return [];
	}
}

/**
 * Check if a path is empty directory
 */
export async function isEmptyDirectory(absPath: string): Promise<boolean> {
	try {
		const items = await readdir(absPath);
		return items.length === 0;
	} catch {
		return false; // Not a directory or can't read
	}
}
