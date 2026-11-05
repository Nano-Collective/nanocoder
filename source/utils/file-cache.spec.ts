import test from 'ava';
import fs, { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mock } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	CACHE_FILE_TTL_MS,
	MAX_CACHEABLE_FILE_SIZE_BYTES,
	MAX_FILE_CACHE_BYTES,
} from '../constants.js';
import {
	clearCache,
	getCacheSize,
	getCachedFileContent,
	getTotalCachedBytes,
	invalidateCache,
	MAX_CACHE_SIZE,
	sweepExpired,
} from './file-cache';
import { buildMinimalPdf } from '@/test-utils/minimal-pdf';

// Helper to create a temp directory for tests
async function createTempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'file-cache-test-'));
}

// Helper to clean up temp directory
async function cleanupTempDir(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true });
}

// Helper to add small delay
function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

test.beforeEach(() => {
	clearCache();
});

test('getCachedFileContent - cache miss reads from disk', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'test.txt');
		await writeFile(filePath, 'hello world', 'utf-8');

		const result = await getCachedFileContent(filePath);

		t.is(result.content, 'hello world');
		t.deepEqual(result.lines, ['hello world']);
		t.is(typeof result.mtime, 'number');
		t.is(typeof result.cachedAt, 'number');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - cache hit returns same content', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'test.txt');
		await writeFile(filePath, 'cached content', 'utf-8');

		const result1 = await getCachedFileContent(filePath);
		const result2 = await getCachedFileContent(filePath);

		// Should return exact same object reference (cache hit)
		t.is(result1, result2);
		t.is(result1.content, 'cached content');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - mtime change triggers re-read', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'test.txt');
		await writeFile(filePath, 'original content', 'utf-8');

		const result1 = await getCachedFileContent(filePath);
		t.is(result1.content, 'original content');

		// Modify file (changes mtime)
		await delay(50); // 50ms ensures different mtime even on filesystems with coarse resolution (e.g. CI runners)
		await writeFile(filePath, 'modified content', 'utf-8');

		const result2 = await getCachedFileContent(filePath);

		// Should have re-read from disk
		t.is(result2.content, 'modified content');
		t.not(result1, result2); // Different object
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - splits content into lines', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'multiline.txt');
		await writeFile(filePath, 'line 1\nline 2\nline 3', 'utf-8');

		const result = await getCachedFileContent(filePath);

		t.deepEqual(result.lines, ['line 1', 'line 2', 'line 3']);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('invalidateCache - removes cache entry', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'test.txt');
		await writeFile(filePath, 'content', 'utf-8');

		await getCachedFileContent(filePath);
		t.is(getCacheSize(), 1);

		invalidateCache(filePath);
		t.is(getCacheSize(), 0);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('invalidateCache - handles non-existent entry gracefully', t => {
	t.notThrows(() => {
		invalidateCache('/non/existent/path');
	});
});

test('clearCache - removes all entries', async t => {
	const tempDir = await createTempDir();
	try {
		const file1 = join(tempDir, 'test1.txt');
		const file2 = join(tempDir, 'test2.txt');
		await writeFile(file1, 'content1', 'utf-8');
		await writeFile(file2, 'content2', 'utf-8');

		await getCachedFileContent(file1);
		await getCachedFileContent(file2);
		t.is(getCacheSize(), 2);

		clearCache();
		t.is(getCacheSize(), 0);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - concurrent access is deduplicated', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'concurrent.txt');
		await writeFile(filePath, 'concurrent content', 'utf-8');

		// Launch multiple concurrent reads - they should be deduplicated
		const [result1, result2, result3] = await Promise.all([
			getCachedFileContent(filePath),
			getCachedFileContent(filePath),
			getCachedFileContent(filePath),
		]);

		// All should return the same content
		t.is(result1.content, 'concurrent content');
		t.is(result2.content, 'concurrent content');
		t.is(result3.content, 'concurrent content');

		// All should return the exact same object (deduplicated read)
		t.is(result1, result2);
		t.is(result2, result3);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - throws on non-existent file', async t => {
	await t.throwsAsync(
		async () => getCachedFileContent('/non/existent/file.txt'),
		{ code: 'ENOENT' },
	);
});

test('getCachedFileContent - cache hit within TTL window returns same object', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'ttl-test.txt');
		await writeFile(filePath, 'original', 'utf-8');

		const result1 = await getCachedFileContent(filePath);
		t.is(result1.content, 'original');

		// Verify entry exists in cache
		t.is(getCacheSize(), 1);

		// Second read within TTL window should return same object
		const result2 = await getCachedFileContent(filePath);
		t.is(result1, result2); // Same object reference = cache hit
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - handles empty file', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'empty.txt');
		await writeFile(filePath, '', 'utf-8');

		const result = await getCachedFileContent(filePath);

		t.is(result.content, '');
		t.deepEqual(result.lines, ['']);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - LRU eviction when cache exceeds MAX_CACHE_SIZE', async t => {
	const tempDir = await createTempDir();
	try {
		// Create MAX_CACHE_SIZE + 1 files to trigger eviction
		const filePaths: string[] = [];
		for (let i = 0; i <= MAX_CACHE_SIZE; i++) {
			const filePath = join(tempDir, `file-${i}.txt`);
			await writeFile(filePath, `content-${i}`, 'utf-8');
			filePaths.push(filePath);
		}

		// Cache the first MAX_CACHE_SIZE files
		for (let i = 0; i < MAX_CACHE_SIZE; i++) {
			await getCachedFileContent(filePaths[i]!);
		}
		t.is(getCacheSize(), MAX_CACHE_SIZE);

		// Access file-0 again to make it recently used
		await getCachedFileContent(filePaths[0]!);

		// Add one more file - this should evict the LRU entry (file-1, not file-0)
		await getCachedFileContent(filePaths[MAX_CACHE_SIZE]!);

		// Cache size should still be MAX_CACHE_SIZE (one was evicted)
		t.is(getCacheSize(), MAX_CACHE_SIZE);

		// file-0 should still be cached (was recently accessed)
		const result0 = await getCachedFileContent(filePaths[0]!);
		t.is(result0.content, 'content-0');

		// The newest file should be cached
		const resultNew = await getCachedFileContent(filePaths[MAX_CACHE_SIZE]!);
		t.is(resultNew.content, `content-${MAX_CACHE_SIZE}`);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

// ============================================================================
// Tests for Retry Mechanism and Edge Cases
// ============================================================================

test('getCachedFileContent - concurrent reads with mtime change get consistent result', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'concurrent-mtime.txt');
		await writeFile(filePath, 'original', 'utf-8');

		// First, cache the file
		const initial = await getCachedFileContent(filePath);
		t.is(initial.content, 'original');

		// Modify the file to trigger mtime change
		await delay(50);
		await writeFile(filePath, 'modified', 'utf-8');

		// Launch multiple concurrent reads - they should all see the modified content
		// and should be deduplicated (not cause multiple disk reads)
		const [result1, result2, result3] = await Promise.all([
			getCachedFileContent(filePath),
			getCachedFileContent(filePath),
			getCachedFileContent(filePath),
		]);

		// All should have the modified content
		t.is(result1.content, 'modified');
		t.is(result2.content, 'modified');
		t.is(result3.content, 'modified');

		// All should be the same object (deduplication worked)
		t.is(result1, result2);
		t.is(result2, result3);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - does not clear a replacement pending read', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'pending-read-race.txt');
		await writeFile(filePath, 'original', 'utf-8');
		await getCachedFileContent(filePath);

		let targetStatCalls = 0;
		let targetReadCalls = 0;
		let replacementRead: ReturnType<typeof getCachedFileContent> | undefined;

		let releaseInitialStats!: () => void;
		const initialStatsReleased = new Promise<void>(resolve => {
			releaseInitialStats = resolve;
		});
		let resolveInitialStatsStarted!: () => void;
		const initialStatsStarted = new Promise<void>(resolve => {
			resolveInitialStatsStarted = resolve;
		});

		let releaseOriginalRead!: () => void;
		const originalReadReleased = new Promise<void>(resolve => {
			releaseOriginalRead = resolve;
		});
		let resolveOriginalReadStarted!: () => void;
		const originalReadStarted = new Promise<void>(resolve => {
			resolveOriginalReadStarted = resolve;
		});

		let releaseReplacementRead!: () => void;
		const replacementReadReleased = new Promise<void>(resolve => {
			releaseReplacementRead = resolve;
		});
		let resolveReplacementReadStarted!: () => void;
		const replacementReadStarted = new Promise<void>(resolve => {
			resolveReplacementReadStarted = resolve;
		});

		const syntheticStat = (mtimeMs: number) => ({ mtimeMs });
		const originalStat = fs.stat;
		const originalReadFile = fs.readFile;

		mock.method(fs, 'stat', async path => {
			if (path !== filePath) {
				return originalStat(path);
			}

			targetStatCalls += 1;
			if (targetStatCalls <= 2) {
				if (targetStatCalls === 2) {
					resolveInitialStatsStarted();
				}
				await initialStatsReleased;
				return syntheticStat(2);
			}

			if (targetStatCalls === 3) {
				// Replace the original pending read before its owner resumes.
				clearCache();
				replacementRead = getCachedFileContent(filePath);
				return syntheticStat(2);
			}

			return syntheticStat(3);
		});

		mock.method(fs, 'readFile', async path => {
			if (path !== filePath) {
				return originalReadFile(path);
			}

			targetReadCalls += 1;
			if (targetReadCalls === 1) {
				resolveOriginalReadStarted();
				await originalReadReleased;
				return Buffer.from('original read');
			}
			if (targetReadCalls === 2) {
				resolveReplacementReadStarted();
				await replacementReadReleased;
				return Buffer.from('replacement read');
			}

			throw new Error('duplicate read after replacement pending read was cleared');
		});

		const firstRead = getCachedFileContent(filePath);
		const secondRead = getCachedFileContent(filePath);
		await initialStatsStarted;
		releaseInitialStats();
		await originalReadStarted;
		releaseOriginalRead();
		await replacementReadStarted;
		await Promise.all([firstRead, secondRead]);

		if (!replacementRead) {
			t.fail('Expected a replacement pending read to be created');
			return;
		}

		const deduplicatedRead = getCachedFileContent(filePath);
		releaseReplacementRead();
		const [replacementResult, deduplicatedResult] = await Promise.all([
			replacementRead,
			deduplicatedRead,
		]);

		t.is(deduplicatedResult, replacementResult);
		t.is(targetReadCalls, 2);
	} finally {
		mock.restoreAll();
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - handles rapid sequential modifications', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'rapid-mods.txt');
		await writeFile(filePath, 'v1', 'utf-8');

		// Cache initial version
		const v1 = await getCachedFileContent(filePath);
		t.is(v1.content, 'v1');

		// Rapidly modify and read multiple times
		for (let i = 2; i <= 5; i++) {
			await delay(50); // 50ms ensures different mtime even on filesystems with coarse resolution (e.g. CI runners)
			await writeFile(filePath, `v${i}`, 'utf-8');
			const result = await getCachedFileContent(filePath);
			t.is(result.content, `v${i}`, `Should see version ${i}`);
		}
	} finally {
		await cleanupTempDir(tempDir);
	}
});

// ============================================================================
// Tests for Binary File Conversion (PDF/DOCX)
// ============================================================================

test('getCachedFileContent - throws descriptive error for corrupt PDF', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'test.pdf');
		// Write a dummy PDF signature
		await writeFile(filePath, '%PDF-1.4\n%Fake PDF content');

		// The real get-md will fail on a fake PDF and throw an error.
		await t.throwsAsync(
			async () => getCachedFileContent(filePath),
			{ message: /Failed to extract text from document/ }
		);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - throws descriptive error for corrupt DOCX', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'test.docx');
		// Write a dummy ZIP signature for DOCX
		await writeFile(filePath, 'PK\x03\x04\nFake DOCX content');

		// The real get-md will fail on a corrupt/fake zip and throw an error.
		// We expect the file-cache to catch this and throw a descriptive error.
		await t.throwsAsync(
			async () => getCachedFileContent(filePath),
			{ message: /Failed to extract text from document/ }
		);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - reads extensionless file as utf-8 text', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'LICENSE');
		await writeFile(filePath, 'plain text\nno extension', 'utf-8');

		const result = await getCachedFileContent(filePath);

		t.is(result.content, 'plain text\nno extension');
		t.deepEqual(result.lines, ['plain text', 'no extension']);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - marks a converted document as derived', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'spec.pdf');
		const bytes = buildMinimalPdf('Hello World');
		await writeFile(filePath, bytes);

		const result = await getCachedFileContent(filePath);

		// The provenance flag and the content have to tell the same story: what
		// came back is a transcript of the document, not the document.
		t.true(result.derived);
		t.regex(result.content, /Hello World/);
		t.false(result.content.startsWith('%PDF-'));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - derived flag survives a cache hit', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'spec.pdf');
		await writeFile(filePath, buildMinimalPdf('Hello World'));

		await getCachedFileContent(filePath);
		const cached = await getCachedFileContent(filePath);

		t.true(cached.derived);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - marks plain text content as not derived', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'notes.md');
		await writeFile(filePath, '# heading', 'utf-8');

		const result = await getCachedFileContent(filePath);

		t.false(result.derived);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test('getCachedFileContent - document extension check is case-insensitive', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'test.PDF');
		await writeFile(filePath, '%PDF-1.4\n%Fake PDF content');

		await t.throwsAsync(
			async () => getCachedFileContent(filePath),
			{ message: /Failed to extract text from document/ }
		);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

// Tests for Byte Budget, Oversized Files, and TTL Sweep on Insert (#1781)

test.serial(
	'getCachedFileContent - does not cache files exceeding MAX_CACHEABLE_FILE_SIZE_BYTES',
	async t => {
		const tempDir = await createTempDir();
		try {
			const filePath = join(tempDir, 'oversized.txt');
			// Create file slightly larger than single-file cache limit
			const largeContent = 'X'.repeat(MAX_CACHEABLE_FILE_SIZE_BYTES + 1024);
			await writeFile(filePath, largeContent, 'utf-8');

			const result1 = await getCachedFileContent(filePath);
			t.is(result1.content.length, largeContent.length);
			t.is(getCacheSize(), 0, 'Oversized file must not be kept in cache');
			t.is(getTotalCachedBytes(), 0);

			// Subsequent read should not be a cache hit (new object returned)
			const result2 = await getCachedFileContent(filePath);
			t.not(result1, result2);
			t.is(getCacheSize(), 0);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'getCachedFileContent - deduplicates concurrent reads of oversized files without caching',
	async t => {
		const tempDir = await createTempDir();
		try {
			const filePath = join(tempDir, 'oversized-concurrent.txt');
			const largeContent = 'Y'.repeat(MAX_CACHEABLE_FILE_SIZE_BYTES + 512);
			await writeFile(filePath, largeContent, 'utf-8');

			const [res1, res2] = await Promise.all([
				getCachedFileContent(filePath),
				getCachedFileContent(filePath),
			]);

			t.is(
				res1,
				res2,
				'Concurrent reads of oversized files should be deduplicated',
			);
			t.is(
				getCacheSize(),
				0,
				'Oversized file should not be kept in cache after read completes',
			);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'getCachedFileContent - evicts oldest entries when total byte budget is exceeded',
	async t => {
		const tempDir = await createTempDir();
		try {
			clearCache();
			// Each file fits under MAX_CACHEABLE_FILE_SIZE_BYTES
			const fileSizeBytes = MAX_CACHEABLE_FILE_SIZE_BYTES;
			const fileCount = Math.floor(MAX_FILE_CACHE_BYTES / fileSizeBytes) + 1;
			const filePaths: string[] = [];

			for (let i = 0; i < fileCount; i++) {
				const filePath = join(tempDir, `budget-file-${i}.txt`);
				await writeFile(filePath, 'Z'.repeat(fileSizeBytes), 'utf-8');
				filePaths.push(filePath);
			}

			// Cache up to byte budget
			const cachedResults: Array<
				Awaited<ReturnType<typeof getCachedFileContent>>
			> = [];
			for (let i = 0; i < fileCount - 1; i++) {
				cachedResults.push(await getCachedFileContent(filePaths[i]!));
			}
			t.is(getCacheSize(), fileCount - 1);
			t.is(getTotalCachedBytes(), (fileCount - 1) * fileSizeBytes);

			// Add one more file to exceed MAX_FILE_CACHE_BYTES
			const newCached = await getCachedFileContent(filePaths[fileCount - 1]!);

			// Total cached bytes must not exceed MAX_FILE_CACHE_BYTES
			t.true(getTotalCachedBytes() <= MAX_FILE_CACHE_BYTES);
			t.is(getTotalCachedBytes(), (fileCount - 1) * fileSizeBytes);
			t.is(getCacheSize(), fileCount - 1);

			// Oldest entry (file 0) was evicted, so re-reading it must return a fresh object
			const reReadOldest = await getCachedFileContent(filePaths[0]!);
			t.not(
				reReadOldest,
				cachedResults[0],
				'Oldest file should have been evicted from cache',
			);

			// Latest entry was kept in cache (same object reference)
			const reReadNew = await getCachedFileContent(filePaths[fileCount - 1]!);
			t.is(reReadNew, newCached, 'Newly cached file should remain in cache');
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'getCachedFileContent - LRU eviction by bytes preserves recently read entry and evicts older entry',
	async t => {
		const tempDir = await createTempDir();
		try {
			clearCache();
			const fileSizeBytes = MAX_CACHEABLE_FILE_SIZE_BYTES; // 4 MB per file
			const maxEntries = Math.floor(MAX_FILE_CACHE_BYTES / fileSizeBytes); // 8 files = 32 MB

			const fileA = join(tempDir, 'lru-a.txt');
			const fileB = join(tempDir, 'lru-b.txt');
			const fileC = join(tempDir, 'lru-c.txt');

			await writeFile(fileA, 'A'.repeat(fileSizeBytes), 'utf-8');
			await writeFile(fileB, 'B'.repeat(fileSizeBytes), 'utf-8');
			await writeFile(fileC, 'C'.repeat(fileSizeBytes), 'utf-8');

			// 1. Read A, then read B
			const resA1 = await getCachedFileContent(fileA);
			const resB1 = await getCachedFileContent(fileB);
			t.is(getCacheSize(), 2);

			// 2. Read filler files to fill the rest of the cache up to budget
			for (let i = 2; i < maxEntries; i++) {
				const fillerPath = join(tempDir, `lru-filler-${i}.txt`);
				await writeFile(fillerPath, 'F'.repeat(fileSizeBytes), 'utf-8');
				await getCachedFileContent(fillerPath);
			}
			t.is(getCacheSize(), maxEntries);
			t.is(getTotalCachedBytes(), MAX_FILE_CACHE_BYTES);

			// 3. Re-read A (cache hit moves A to end of Map / most recently used)
			const resA2 = await getCachedFileContent(fileA);
			t.is(resA1, resA2, 'Cache hit returns same object reference');

			// 4. Force eviction by reading C (4 MB) -> oldest entry B must be evicted, A must survive
			await getCachedFileContent(fileC);
			t.is(getCacheSize(), maxEntries);
			t.is(getTotalCachedBytes(), MAX_FILE_CACHE_BYTES);

			// Assert A survived (cache hit, same object reference)
			const resA3 = await getCachedFileContent(fileA);
			t.is(
				resA1,
				resA3,
				'Entry A was re-read before C and should survive LRU eviction',
			);

			// Assert B was evicted (re-reading B returns a new object from disk)
			const resB2 = await getCachedFileContent(fileB);
			t.not(
				resB1,
				resB2,
				'Entry B was least recently used and should have been evicted',
			);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'getCachedFileContent - sweeps expired entries on insert without re-reading them',
	async t => {
		const tempDir = await createTempDir();
		const originalDateNow = Date.now;
		try {
			clearCache();
			const fileA = join(tempDir, 'file-a.txt');
			const fileB = join(tempDir, 'file-b.txt');
			await writeFile(fileA, 'content-a', 'utf-8');
			await writeFile(fileB, 'content-b', 'utf-8');

			let simulatedTime = originalDateNow.call(Date);
			Date.now = () => simulatedTime;

			await getCachedFileContent(fileA);
			t.is(getCacheSize(), 1);

			// Advance time past CACHE_FILE_TTL_MS
			simulatedTime += CACHE_FILE_TTL_MS + 100;

			// Cache file B (new insert) - this should sweep expired file A
			await getCachedFileContent(fileB);

			// File A was not requested, but should have been purged by the insert sweep
			t.is(getCacheSize(), 1);
			t.is(getTotalCachedBytes(), Buffer.byteLength('content-b', 'utf-8'));
		} finally {
			Date.now = originalDateNow;
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial('sweepExpired - sweeps entries older than TTL directly', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = join(tempDir, 'expire-test.txt');
		await writeFile(filePath, 'hello', 'utf-8');

		await getCachedFileContent(filePath);
		t.is(getCacheSize(), 1);

		// Before TTL: sweepExpired sweeps nothing
		t.is(sweepExpired(Date.now()), 0);
		t.is(getCacheSize(), 1);

		// Advance simulated time past TTL
		const future = Date.now() + CACHE_FILE_TTL_MS + 1000;
		const swept = sweepExpired(future);
		t.is(swept, 1);
		t.is(getCacheSize(), 0);
		t.is(getTotalCachedBytes(), 0);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial(
	'getCachedFileContent - tracking total cached bytes accurately through invalidation and mtime updates',
	async t => {
		const tempDir = await createTempDir();
		try {
			const filePath = join(tempDir, 'byte-track.txt');
			await writeFile(filePath, '12345', 'utf-8'); // 5 bytes

			await getCachedFileContent(filePath);
			t.is(getTotalCachedBytes(), 5);

			// Modify file to 10 bytes
			await delay(10);
			await writeFile(filePath, '1234567890', 'utf-8'); // 10 bytes

			await getCachedFileContent(filePath);
			t.is(getTotalCachedBytes(), 10);

			// Invalidate
			invalidateCache(filePath);
			t.is(getTotalCachedBytes(), 0);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

