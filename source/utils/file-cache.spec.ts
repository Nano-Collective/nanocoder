import test from 'ava';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	getCachedFileContent,
	invalidateCache,
	clearCache,
	getCacheSize,
	MAX_CACHE_SIZE,
} from './file-cache';

// Helper to create a temp directory for tests
async function createTempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'file-cache-test-'));
}

// Helper to clean up temp directory
async function cleanupTempDir(dir: string): Promise<void> {
	await rm(dir, {recursive: true, force: true});
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
		await delay(10); // Ensure different mtime
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
		{code: 'ENOENT'},
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
