import fs from 'node:fs/promises';
import {CACHE_FILE_TTL_MS, MAX_FILE_READ_RETRIES} from '@/constants';
import {isDerivedContentPath} from '@/utils/derived-content';
import {withPreservedProcess} from '@/utils/preserve-process';

/**
 * File content cache to reduce duplicate file reads during tool confirmation flow.
 *
 * The cache stores file content with mtime tracking to ensure data freshness.
 * Entries auto-expire after TTL_MS and are invalidated if file mtime changes.
 */

/** Maximum number of files to cache (exported for testing) */
export const MAX_CACHE_SIZE = 50;

export interface CachedFile {
	content: string;
	lines: string[];
	mtime: number;
	cachedAt: number;
	/**
	 * True when `content` is a derived representation of the file (the markdown
	 * transcript of a PDF/DOCX) rather than the bytes on disk. Callers that write
	 * content back must refuse these paths: the transcript is not the document.
	 */
	derived: boolean;
}

interface CacheEntry {
	data: CachedFile;
	accessOrder: number;
}

/**
 * Error thrown when a file's bytes cannot survive a UTF-8 decode/encode round
 * trip, so writing decoded content back would change bytes the edit never
 * touched. Legacy-encoded files (Latin-1, Windows-1252, Shift-JIS, ...) hit
 * this: every byte that does not decode becomes U+FFFD.
 */
class NotRoundTrippableError extends Error {
	constructor(public readonly path: string) {
		super(
			`${path} is not valid UTF-8. Editing it would replace bytes outside the edit ` +
				`with the replacement character, so the edit was refused. Convert the file to ` +
				`UTF-8 first (for example with iconv) and try again.`,
		);
		this.name = 'NotRoundTrippableError';
	}
}

/**
 * Asserts that a file's current bytes can be reconstructed from the cached
 * content.
 *
 * The cache decodes with `Buffer.toString('utf-8')`, which is lossy: a byte
 * that is not valid UTF-8 becomes U+FFFD and cannot be recovered on write.
 * Callers that write the cached content back must check this first, or an edit
 * to one line silently damages every other line carrying such a byte.
 *
 * The check re-encodes the cached content and compares against the bytes on
 * disk: comparing decodes instead would pass, because decoding the damaged
 * bytes reproduces the same replacement characters.
 *
 * Returns normally when the round trip is lossless; throws
 * {@link NotRoundTrippableError} otherwise.
 */
export async function assertRoundTrippable(
	absPath: string,
	cachedContent: string,
): Promise<void> {
	const onDisk = await fs.readFile(absPath);
	if (Buffer.from(cachedContent, 'utf-8').equals(onDisk)) {
		return;
	}
	throw new NotRoundTrippableError(absPath);
}

// Internal cache storage
const cache = new Map<string, CacheEntry>();
let accessCounter = 0;

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
			cache.delete(absPath);
		} else {
			// Check if file mtime has changed
			try {
				const fileStat = await fs.stat(absPath);
				const currentMtime = fileStat.mtimeMs;

				if (currentMtime === data.mtime) {
					// Cache hit - update access order for LRU
					entry.accessOrder = ++accessCounter;
					return data;
				}
				// File was modified, invalidate cache and re-read
				cache.delete(absPath);

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

	const cachedFile: CachedFile = {
		content,
		lines: content.split('\n'),
		mtime: mtimeAfter,
		cachedAt: now,
		derived,
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
