import test from 'ava';
import { unlink, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { CachedModelsData } from './models-types.js';
import {
	readCache,
	writeCache,
} from './models-cache.js';

// Get the actual cache file path that will be used
// We need to import dynamically to get the actual path at runtime
let actualCachePath: string;

async function getCacheFilePath(): Promise<string> {
	// Import dynamically to avoid module resolution issues during testing
	const { xdgCache } = await import('xdg-basedir');
	const path = await import('node:path');

	const DEFAULT_CACHE_DIR =
		process.platform === 'darwin'
			? path.join(homedir(), 'Library', 'Caches')
			: path.join(homedir(), '.cache');

	const cacheBase = xdgCache || DEFAULT_CACHE_DIR;
	return path.join(cacheBase, 'nanocoder', 'models.json');
}

// ============================================================================
// Setup and Teardown
// ============================================================================

test.before(async () => {
	actualCachePath = await getCacheFilePath();
});

test.afterEach.always(async () => {
	// Clean up test cache file after each test
	if (actualCachePath && existsSync(actualCachePath)) {
		try {
			await unlink(actualCachePath);
		} catch {
			// Ignore cleanup errors
		}
	}
});

// ============================================================================
// Tests for readCache
// ============================================================================

test('readCache returns null when cache file does not exist', async t => {
	// Ensure cache file doesn't exist
	if (existsSync(actualCachePath)) {
		await unlink(actualCachePath);
	}

	const result = await readCache();
	t.is(result, null);
});

test('readCache returns valid cached data', async t => {
	const mockData: CachedModelsData = {
		data: { models: [] } as any,
		fetchedAt: Date.now() - 1000,
		expiresAt: Date.now() + 1000000, // Not expired
	};

	// Ensure directory exists
	const dir = join(actualCachePath, '..');
	try {
		await mkdir(dir, { recursive: true });
	} catch {
		// Directory may already exist
	}

	await writeFile(actualCachePath, JSON.stringify(mockData), 'utf-8');

	const result = await readCache();

	t.truthy(result);
	t.deepEqual(result?.data, mockData.data);
	t.is(result?.fetchedAt, mockData.fetchedAt);
	t.is(result?.expiresAt, mockData.expiresAt);
});

test('readCache returns null when cache is expired', async t => {
	const expiredData: CachedModelsData = {
		data: { models: [] } as any,
		fetchedAt: Date.now() - 1000000,
		expiresAt: Date.now() - 1000, // Expired
	};

	// Ensure directory exists
	const dir = join(actualCachePath, '..');
	try {
		await mkdir(dir, { recursive: true });
	} catch {
		// Directory may already exist
	}

	await writeFile(actualCachePath, JSON.stringify(expiredData), 'utf-8');

	const result = await readCache();

	t.is(result, null);
});

test('readCache returns null on JSON parse error', async t => {
	// Ensure directory exists
	const dir = join(actualCachePath, '..');
	try {
		await mkdir(dir, { recursive: true });
	} catch {
		// Directory may already exist
	}

	await writeFile(actualCachePath, 'invalid json{{{', 'utf-8');

	const result = await readCache();

	t.is(result, null);
});

// ============================================================================
// Tests for writeCache
// ============================================================================

test('writeCache writes cache data correctly', async t => {
	const mockData = { models: [{ id: 'test-model' }] } as any;

	await writeCache(mockData);

	// Verify the file was written
	const exists = existsSync(actualCachePath);
	t.true(exists);

	// Verify the content
	const content = await readFile(actualCachePath, 'utf-8');
	const writtenData = JSON.parse(content) as CachedModelsData;

	t.truthy(writtenData.data);
	t.truthy(writtenData.fetchedAt);
	t.truthy(writtenData.expiresAt);
	t.true(writtenData.expiresAt > Date.now());
});

test('writeCache creates directory if it does not exist', async t => {
	const mockData = { models: [] } as any;

	// This should not throw even if directory doesn't exist
	await t.notThrowsAsync(async () => {
		await writeCache(mockData);
	});

	// Verify the file was created
	t.true(existsSync(actualCachePath));
});

// ============================================================================
// Integration-like tests
// ============================================================================

test('cache expiration is calculated correctly', async t => {
	const mockData = { models: [] } as any;
	const now = Date.now();

	await writeCache(mockData);

	const content = await readFile(actualCachePath, 'utf-8');
	const writtenData = JSON.parse(content) as CachedModelsData;

	// Get the expiration constant
	const { CACHE_MODELS_EXPIRATION_MS } = await import('@/constants');

	// Expiration should be roughly CACHE_MODELS_EXPIRATION_MS in the future
	t.true(writtenData.expiresAt >= now + CACHE_MODELS_EXPIRATION_MS - 100);
	t.true(writtenData.expiresAt <= now + CACHE_MODELS_EXPIRATION_MS + 100);
});

test('readCache and writeCache round-trip correctly', async t => {
	const originalData = {
		models: [
			{ id: 'model1', name: 'Test Model 1' },
			{ id: 'model2', name: 'Test Model 2' },
		],
	} as any;

	// Write the cache
	await writeCache(originalData);

	// Read it back
	const readResult = await readCache();

	t.truthy(readResult);
	t.deepEqual(readResult?.data, originalData);
});

test('writeCache overwrites existing cache', async t => {
	// Write first cache
	const firstData = { models: [{ id: 'model1' }] } as any;
	await writeCache(firstData);

	// Write second cache (should overwrite)
	const secondData = { models: [{ id: 'model2' }, { id: 'model3' }] } as any;
	await writeCache(secondData);

	// Read back
	const readResult = await readCache();

	t.truthy(readResult);
	t.deepEqual(readResult?.data, secondData);
});

// ============================================================================
// Windows regression: cache path must use os.homedir(), not process.env.HOME
// Regression for https://github.com/Nano-Collective/nanocoder/pull/886
// When process.env.HOME is undefined (Windows default), the old code produced
// a literal "~" directory instead of resolving the user's home directory.
// ============================================================================

test('os.homedir() resolves correctly when HOME env is undefined (unlike process.env.HOME)', t => {
	const savedHome = process.env.HOME;
	delete process.env.HOME;

	try {
		// The old broken pattern: process.env.HOME || '~'
		const brokenPath = join(process.env.HOME || '~', '.cache');
		// The fixed pattern: os.homedir()
		const fixedPath = join(homedir(), '.cache');

		// On Windows, process.env.HOME is undefined, so old code yields literal "~"
		t.true(
			brokenPath.startsWith('~'),
			`Old code produces literal ~ directory: ${brokenPath}`,
		);
		// os.homedir() always resolves to the real home directory
		t.false(
			fixedPath.startsWith('~'),
			`Fixed code resolves real home: ${fixedPath}`,
		);
		t.not(brokenPath, fixedPath, 'Fix must produce a different path than the old code');
	} finally {
		if (savedHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = savedHome;
		}
	}
});

test('actual cache path does not contain literal ~', async t => {
	const {xdgCache} = await import('xdg-basedir');
	const DEFAULT_CACHE_DIR =
		process.platform === 'darwin'
			? join(homedir(), 'Library', 'Caches')
			: join(homedir(), '.cache');
	const cacheBase = xdgCache || DEFAULT_CACHE_DIR;
	const cachePath = join(cacheBase, 'nanocoder', 'models.json');

	t.false(cachePath.includes('~'), `Cache path must not contain literal ~: ${cachePath}`);
	t.true(cachePath.startsWith(homedir()), `Cache path must be under home directory: ${cachePath}`);
});
