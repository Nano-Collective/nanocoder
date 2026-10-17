import fs from 'node:fs/promises';
import {
	CACHE_FILE_TTL_MS,
	MAX_CACHEABLE_FILE_SIZE_BYTES,
	MAX_FILE_CACHE_BYTES,
	MAX_FILE_READ_RETRIES,
} from '@/constants';
import {isDerivedContentPath} from '@/utils/derived-content';
import {withPreservedProcess} from '@/utils/preserve-process';

/**
 * File content cache to reduce duplicate file reads during tool confirmation flow.
 *
 * The cache stores file content with mtime tracking to ensure data freshness.
 * Entries auto-expire after TTL_MS and are invalidated if file mtime changes.
 */

/** Maximum number of files to cache (exported for testing and backwards compatibility) */
export const MAX_CACHE_SIZE = 50;

export interface CachedFile {
	content: string;
	readonly lines: string[];
	readonly totalLines: number;
	mtime: number;
	cachedAt: number;
	/**
	 * True when `content` is a derived representation of the file (the markdown
	 * transcript of a PDF/DOCX) rather than the bytes on disk. Callers that write
	 * content back must refuse these paths: the transcript is not the document.
	 */
	derived: boolean;
}

function countLines(content: string): number {
	let count = 1;
	let pos = content.indexOf('\n');
	while (pos !== -1) {
		count++;
		pos = content.indexOf('\n', pos + 1);
	}
	return count;
}

function toCachedFile(
	content: string,
	mtime = 0,
	cachedAt = Date.now(),
	derived = false,
): CachedFile {
	return {
		content,
		get lines() {
			return content.split('\n');
		},
		totalLines: countLines(content),
		mtime,
		cachedAt,
		derived,
	};
}

interface CacheEntry {
	data: CachedFile;
	accessOrder: number;
	sizeBytes: number;
}

// Internal cache storage
const cache = new Map<string, CacheEntry>();
let accessCounter = 0;
let totalCachedBytes = 0;

// Track pending reads to deduplicate concurrent requests for the same file
const pendingReads = new Map<string, Promise<CachedFile>>();

function cleanupPendingRead(
	absPath: string,
	pending: Promise<CachedFile>,
): void {
	if (pendingReads.get(absPath) === pending) {
		pendingReads.delete(absPath);
	}
}

function deleteFromCache(absPath: string): void {
	const entry = cache.get(absPath);
	if (entry) {
		totalCachedBytes = Math.max(0, totalCachedBytes - entry.sizeBytes);
		cache.delete(absPath);
	}
}

/**
 * Sweep expired entries from the cache based on TTL.
 * Returns the number of entries swept.
 */
export function sweepExpired(now = Date.now()): number {
	let sweptCount = 0;
	for (const [key, entry] of cache) {
		if (now - entry.data.cachedAt > CACHE_FILE_TTL_MS) {
			deleteFromCache(key);
			sweptCount++;
		}
	}
	return sweptCount;
}

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
		if (now - data.cachedAt > CACHE_FILE_TTL_MS) {
			deleteFromCache(absPath);
		} else {
			// Check if file mtime has changed
			try {
				const fileStat = await fs.stat(absPath);
				const currentMtime = fileStat.mtimeMs;

				if (currentMtime === data.mtime) {
					// Cache hit - update access order and move entry to end of Map for true LRU
					entry.accessOrder = ++accessCounter;
					cache.delete(absPath);
					cache.set(absPath, entry);
					return data;
				}
				// File was modified, invalidate cache and re-read
				deleteFromCache(absPath);

				// Check for pending read before starting a new one (deduplication)
				let pending = pendingReads.get(absPath);
				let ownsPendingRead = false;
				if (!pending) {
					// Reuse the stat we just did to avoid double stat
					pending = readAndCacheFile(absPath, now, fileStat.mtimeMs);
					pendingReads.set(absPath, pending);
					ownsPendingRead = true;
				}

				try {
					return await pending;
				} finally {
					if (ownsPendingRead) {
						cleanupPendingRead(absPath, pending);
					}
				}
			} catch {
				// File may have been deleted, invalidate cache
				deleteFromCache(absPath);
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
		cleanupPendingRead(absPath, readPromise);
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
	const mtimeBefore = knownMtime ?? (await fs.stat(absPath)).mtimeMs;

	// Read as Buffer to support both text and binary formats
	const buffer = await fs.readFile(absPath);

	// Verify mtime didn't change during read
	const mtimeAfter = (await fs.stat(absPath)).mtimeMs;
	if (mtimeAfter !== mtimeBefore) {
		if (retryCount >= MAX_FILE_READ_RETRIES) {
			throw new Error(
				`File ${absPath} is being modified too frequently, giving up after ${MAX_FILE_READ_RETRIES} retries`,
			);
		}
		// File changed during read, retry with fresh timestamp
		return readAndCacheFile(absPath, Date.now(), undefined, retryCount + 1);
	}

	let content: string;
	const derived = isDerivedContentPath(absPath);

	if (derived) {
		try {
			const {convertToMarkdown} = await import('@nanocollective/get-md');
			// The conversion runs guarded to protect `globalThis.process`.
			const result = await withPreservedProcess(() =>
				// biome-ignore lint/suspicious/noExplicitAny: buffer types mismatch between get-md and native
				convertToMarkdown(buffer as any),
			);
			content = result.markdown;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to extract text from document: ${errorMessage}`);
		}
	} else {
		content = buffer.toString('utf-8');
	}

	const sizeBytes = Buffer.byteLength(content, 'utf-8');

	// Sweep expired entries on insert
	sweepExpired(now);

	// Do not cache files exceeding the single-file size threshold or total budget
	if (
		sizeBytes > MAX_CACHEABLE_FILE_SIZE_BYTES ||
		sizeBytes > MAX_FILE_CACHE_BYTES
	) {
		deleteFromCache(absPath);
		return toCachedFile(content, mtimeAfter, now, derived);
	}

	// If replacing an existing entry for this path, remove old size first
	deleteFromCache(absPath);

	// Enforce byte budget and max item capacity with LRU eviction
	while (
		(totalCachedBytes + sizeBytes > MAX_FILE_CACHE_BYTES ||
			cache.size >= MAX_CACHE_SIZE) &&
		cache.size > 0
	) {
		evictLRU();
	}

	const cachedFile = toCachedFile(content, mtimeAfter, now, derived);
	cache.set(absPath, {
		data: cachedFile,
		accessOrder: ++accessCounter,
		sizeBytes,
	});
	totalCachedBytes += sizeBytes;

	return cachedFile;
}

/**
 * Invalidate cache entry for a specific file.
 * Should be called after write operations complete.
 *
 * @param absPath - Absolute path to the file to invalidate
 */
export function invalidateCache(absPath: string): void {
	deleteFromCache(absPath);
}

/**
 * Clear all cache entries.
 */
export function clearCache(): void {
	cache.clear();
	pendingReads.clear();
	accessCounter = 0;
	totalCachedBytes = 0;
}

/**
 * Get current cache size (for testing/debugging).
 */
export function getCacheSize(): number {
	return cache.size;
}

/**
 * Get current total cached bytes (for testing/debugging).
 */
export function getTotalCachedBytes(): number {
	return totalCachedBytes;
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
		deleteFromCache(oldestKey);
	}
}
