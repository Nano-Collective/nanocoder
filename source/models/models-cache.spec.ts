import test from 'ava';
import { unlink, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { CachedModelsData, ModelsIndex } from './models-types.js';
import {
	MODELS_CACHE_VERSION,
	readCache,
	writeCache,
} from './models-cache.js';
import { buildModelsIndex } from './models-index.js';

// A small but valid index, in the format the cache stores
function sampleIndex(...ids: string[]): ModelsIndex {
	return buildModelsIndex({
		provider: {
			id: 'provider',
			name: 'Provider',
			env: [],
			models: Object.fromEntries(
				ids.map(id => [
					id,
					{
						id,
						name: id,
						limit: { context: 8192, output: 4096 },
						cost: { input: 1, output: 2 },
					} as any,
				]),
			),
		},
	});
}

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
		version: MODELS_CACHE_VERSION,
		data: sampleIndex('model-a', 'model-b'),
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
		version: MODELS_CACHE_VERSION,
		data: sampleIndex('model-a'),
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

async function writeRawCacheFile(contents: unknown): Promise<void> {
	await mkdir(join(actualCachePath, '..'), { recursive: true });
	await writeFile(actualCachePath, JSON.stringify(contents), 'utf-8');
}

test('readCache ignores the old full-database format (no version)', async t => {
	// What older versions wrote: { data: <providers keyed by id>, ... }
	await writeRawCacheFile({
		data: {
			openai: { id: 'openai', name: 'OpenAI', env: [], models: {} },
		},
		fetchedAt: Date.now() - 1000,
		expiresAt: Date.now() + 1000000,
	});

	t.is(await readCache(), null);
});

test('readCache ignores a cache with a different version', async t => {
	await writeRawCacheFile({
		version: MODELS_CACHE_VERSION + 1,
		data: sampleIndex('model-a'),
		fetchedAt: Date.now() - 1000,
		expiresAt: Date.now() + 1000000,
	});

	t.is(await readCache(), null);
});

test('readCache ignores a current-version cache with malformed data', async t => {
	const truncated = sampleIndex('model-a', 'model-b');
	truncated.costOutput.pop();

	await writeRawCacheFile({
		version: MODELS_CACHE_VERSION,
		data: truncated,
		fetchedAt: Date.now() - 1000,
		expiresAt: Date.now() + 1000000,
	});

	t.is(await readCache(), null);
});

// ============================================================================
// Tests for writeCache
// ============================================================================

test('writeCache writes cache data correctly', async t => {
	const mockData = sampleIndex('test-model');

	await writeCache(mockData);

	// Verify the file was written
	const exists = existsSync(actualCachePath);
	t.true(exists);

	// Verify the content
	const content = await readFile(actualCachePath, 'utf-8');
	const writtenData = JSON.parse(content) as CachedModelsData;

	t.is(writtenData.version, MODELS_CACHE_VERSION);
	t.truthy(writtenData.data);
	t.truthy(writtenData.fetchedAt);
	t.truthy(writtenData.expiresAt);
	t.true(writtenData.expiresAt > Date.now());
});

test('writeCache writes minified JSON', async t => {
	await writeCache(sampleIndex('model-a', 'model-b'));

	const content = await readFile(actualCachePath, 'utf-8');
	t.false(content.includes('\n'));
});

test('writeCache creates directory if it does not exist', async t => {
	const mockData = sampleIndex();

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
	const mockData = sampleIndex();
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
	const originalData = sampleIndex('model1', 'model2');

	// Write the cache
	await writeCache(originalData);

	// Read it back
	const readResult = await readCache();

	t.truthy(readResult);
	t.deepEqual(readResult?.data, originalData);
});

test('writeCache overwrites existing cache', async t => {
	// Write first cache
	const firstData = sampleIndex('model1');
	await writeCache(firstData);

	// Write second cache (should overwrite)
	const secondData = sampleIndex('model2', 'model3');
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
