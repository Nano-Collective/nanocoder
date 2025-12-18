import {readFile, stat} from 'node:fs/promises';

/**
 * File content cache to reduce duplicate file reads during tool confirmation flow.
 *
 * The cache stores file content with mtime tracking to ensure data freshness.
 * Entries auto-expire after TTL_MS and are invalidated if file mtime changes.
 */

const TTL_MS = 5000; // 5 seconds
const MAX_CACHE_SIZE = 50; // Maximum number of files to cache

export interface CachedFile {
	content: string;
	lines: string[];
	mtime: number;
	cachedAt: number;
}

interface CacheEntry {
	data: CachedFile;
	accessOrder: number;
}

// Internal cache storage
const cache = new Map<string, CacheEntry>();
let accessCounter = 0;

/**
 * Get file content from cache or read from disk.
 * Automatically checks mtime to ensure freshness.
 *
 * @param absPath - Absolute path to the file
 * @returns Cached file data with content, lines array, and mtime
 */
export async function getCachedFileContent(
	absPath: string,
): Promise<CachedFile> {
	const now = Date.now();
	const entry = cache.get(absPath);

	if (entry) {
		const {data} = entry;

		// Check if cache entry has expired (TTL)
		if (now - data.cachedAt > TTL_MS) {
			cache.delete(absPath);
		} else {
			// Check if file mtime has changed
			try {
				const fileStat = await stat(absPath);
				const currentMtime = fileStat.mtimeMs;

				if (currentMtime === data.mtime) {
					// Cache hit - update access order for LRU
					entry.accessOrder = ++accessCounter;
					return data;
				}
				// File was modified, invalidate cache and re-read
				cache.delete(absPath);
				// Reuse the stat we just did to avoid double stat
				return readAndCacheFile(absPath, now, fileStat.mtimeMs);
			} catch {
				// File may have been deleted, invalidate cache
				cache.delete(absPath);
			}
		}
	}

	// Cache miss - read from disk
	return readAndCacheFile(absPath, now);
}

/**
 * Read file from disk and cache it.
 * Verifies mtime didn't change during read to prevent race conditions.
 */
async function readAndCacheFile(
	absPath: string,
	now: number,
	knownMtime?: number,
): Promise<CachedFile> {
	// Get mtime before reading (or use known mtime from caller)
	const mtimeBefore = knownMtime ?? (await stat(absPath)).mtimeMs;

	const content = await readFile(absPath, 'utf-8');

	// Verify mtime didn't change during read
	const mtimeAfter = (await stat(absPath)).mtimeMs;
	if (mtimeAfter !== mtimeBefore) {
		// File changed during read, retry
		return readAndCacheFile(absPath, now);
	}

	const cachedFile: CachedFile = {
		content,
		lines: content.split('\n'),
		mtime: mtimeAfter,
		cachedAt: now,
	};

	// Enforce max cache size with LRU eviction
	if (cache.size >= MAX_CACHE_SIZE) {
		evictLRU();
	}

	cache.set(absPath, {
		data: cachedFile,
		accessOrder: ++accessCounter,
	});

	return cachedFile;
}

/**
 * Invalidate cache entry for a specific file.
 * Should be called after write operations complete.
 *
 * @param absPath - Absolute path to the file to invalidate
 */
export function invalidateCache(absPath: string): void {
	cache.delete(absPath);
}

/**
 * Clear all cache entries.
 */
export function clearCache(): void {
	cache.clear();
	accessCounter = 0;
}

/**
 * Get current cache size (for testing/debugging).
 */
export function getCacheSize(): number {
	return cache.size;
}

/**
 * Evict the least recently used entry from the cache.
 */
function evictLRU(): void {
	let oldestKey: string | null = null;
	let oldestOrder = Infinity;

	for (const [key, entry] of cache) {
		if (entry.accessOrder < oldestOrder) {
			oldestOrder = entry.accessOrder;
			oldestKey = key;
		}
	}

	if (oldestKey) {
		cache.delete(oldestKey);
	}
}
