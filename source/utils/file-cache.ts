import {readFile, stat} from 'node:fs/promises';

/**
 * File content cache to reduce duplicate file reads during tool confirmation flow.
 *
 * The cache stores file content with mtime tracking to ensure data freshness.
 * Entries auto-expire after TTL_MS and are invalidated if file mtime changes.
 */

const TTL_MS = 5000; // 5 seconds
const MAX_READ_RETRIES = 3; // Maximum retries if file changes during read

/** Maximum number of files to cache (exported for testing) */
export const MAX_CACHE_SIZE = 50;

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

// Track pending reads to deduplicate concurrent requests for the same file
const pendingReads = new Map<string, Promise<CachedFile>>();

/**
 * Get file content from cache or read from disk.
 * Automatically checks mtime to ensure freshness.
 * Deduplicates concurrent requests for the same file.
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

	// Check if there's already a pending read for this file
	const pending = pendingReads.get(absPath);
	if (pending) {
		return pending;
	}

	// Cache miss - read from disk with deduplication
	const readPromise = readAndCacheFile(absPath, now);
	pendingReads.set(absPath, readPromise);

	try {
		return await readPromise;
	} finally {
		pendingReads.delete(absPath);
	}
}

/**
 * Read file from disk and cache it.
 * Verifies mtime didn't change during read to prevent race conditions.
 * Retries up to MAX_READ_RETRIES times if file changes during read.
 */
async function readAndCacheFile(
	absPath: string,
	now: number,
	knownMtime?: number,
	retryCount = 0,
): Promise<CachedFile> {
	// Get mtime before reading (or use known mtime from caller)
	const mtimeBefore = knownMtime ?? (await stat(absPath)).mtimeMs;

	const content = await readFile(absPath, 'utf-8');

	// Verify mtime didn't change during read
	const mtimeAfter = (await stat(absPath)).mtimeMs;
	if (mtimeAfter !== mtimeBefore) {
		if (retryCount >= MAX_READ_RETRIES) {
			throw new Error(
				`File ${absPath} is being modified too frequently, giving up after ${MAX_READ_RETRIES} retries`,
			);
		}
		// File changed during read, retry
		return readAndCacheFile(absPath, now, undefined, retryCount + 1);
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
	pendingReads.clear();
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
