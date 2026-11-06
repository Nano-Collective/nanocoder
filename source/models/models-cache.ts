/**
 * Cache management for models.dev data
 * Stores model database in XDG_CACHE_HOME for fast lookup
 */

import {constants} from 'node:fs';
import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {xdgCache} from 'xdg-basedir';
import {CACHE_MODELS_EXPIRATION_MS} from '@/constants';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';
import {isModelsIndex} from './models-index.js';
import type {CachedModelsData, ModelsIndex} from './models-types.js';

/**
 * Bump when the shape of the cached data changes. Cache files written with any
 * other version (including the pre-index format, which has none) are ignored
 * and refetched rather than misread.
 */
export const MODELS_CACHE_VERSION = 2;

const DEFAULT_CACHE_DIR =
	process.platform === 'darwin'
		? path.join(os.homedir(), 'Library', 'Caches')
		: path.join(os.homedir(), '.cache');

function getCacheDir(): string {
	const cacheBase = xdgCache || DEFAULT_CACHE_DIR;
	return path.join(cacheBase, 'nanocoder');
}

function getCacheFilePath(): string {
	return path.join(getCacheDir(), 'models.json');
}

async function ensureCacheDir(): Promise<void> {
	const dir = getCacheDir();

	try {
		await access(dir, constants.F_OK);
	} catch {
		await mkdir(dir, {recursive: true});
	}
}

export async function readCache(): Promise<CachedModelsData | null> {
	try {
		const cachePath = getCacheFilePath();

		await access(cachePath, constants.F_OK);

		const content = await readFile(cachePath, 'utf-8');
		const cached = JSON.parse(content) as CachedModelsData;

		// Check if cache is expired
		if (Date.now() > cached.expiresAt) {
			return null;
		}

		// Ignore caches written in another format (e.g. the full database that
		// older versions stored) and let the caller fetch a fresh copy
		if (
			cached.version !== MODELS_CACHE_VERSION ||
			!isModelsIndex(cached.data)
		) {
			getLogger().debug(
				{version: cached.version},
				'Ignoring models cache with unsupported format',
			);
			return null;
		}

		return cached;
	} catch (error) {
		// If there's any error reading cache, return null to trigger fresh fetch
		const logger = getLogger();
		logger.warn({error: formatError(error)}, 'Failed to read models cache');
		return null;
	}
}

export async function writeCache(data: ModelsIndex): Promise<void> {
	try {
		await ensureCacheDir();

		const cached: CachedModelsData = {
			version: MODELS_CACHE_VERSION,
			data,
			fetchedAt: Date.now(),
			expiresAt: Date.now() + CACHE_MODELS_EXPIRATION_MS,
		};

		const cachePath = getCacheFilePath();
		await writeFile(cachePath, JSON.stringify(cached), 'utf-8');
	} catch (error) {
		const logger = getLogger();
		logger.warn({error: formatError(error)}, 'Failed to write models cache');
	}
}
