#!/usr/bin/env node

/**
 * Post-install script to fetch and cache models.dev data
 * This script runs after npm/pnpm install to ensure fresh model metadata
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {request} from 'undici';
import {xdgCache} from 'xdg-basedir';

const MODELS_DEV_API_URL = 'https://models.dev/api.json';
const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Get cache directory
const DEFAULT_CACHE_DIR =
	process.platform === 'darwin'
		? path.join(os.homedir(), 'Library', 'Caches')
		: path.join(os.homedir(), '.cache');

const cacheBase = xdgCache || DEFAULT_CACHE_DIR;
const cacheDir = path.join(cacheBase, 'nanocoder');
const cacheFilePath = path.join(cacheDir, 'models.json');

/**
 * Fetch models data from models.dev
 */
async function fetchModels() {
	console.log('Fetching model metadata from models.dev...');

	try {
		const response = await request(MODELS_DEV_API_URL, {
			method: 'GET',
			headersTimeout: 10000,
			bodyTimeout: 30000,
		});

		if (response.statusCode !== 200) {
			throw new Error(`HTTP ${response.statusCode}`);
		}

		const data = await response.body.json();

		// Count models for logging
		let totalModels = 0;
		for (const provider of Object.values(data)) {
			totalModels += Object.keys(provider.models).length;
		}

		console.log(
			`✅ Successfully fetched ${totalModels} models from ${
				Object.keys(data).length
			} providers`,
		);

		return data;
	} catch (error) {
		console.warn('⚠️  Failed to fetch models.dev data:', error.message);
		return null;
	}
}

/**
 * Ensure cache directory exists
 */
function ensureCacheDir() {
	if (!fs.existsSync(cacheDir)) {
		fs.mkdirSync(cacheDir, {recursive: true});
	}
}

/**
 * Write data to cache
 */
function writeCache(data) {
	try {
		ensureCacheDir();

		const cached = {
			data,
			fetchedAt: Date.now(),
			expiresAt: Date.now() + CACHE_EXPIRATION_MS,
		};

		fs.writeFileSync(cacheFilePath, JSON.stringify(cached, null, 2), 'utf-8');
		console.log(`💾 Cached to: ${cacheFilePath}`);
	} catch (error) {
		console.warn('⚠️  Failed to write cache:', error.message);
	}
}

/**
 * Check if existing cache is valid
 */
function isCacheValid() {
	try {
		if (!fs.existsSync(cacheFilePath)) {
			return false;
		}

		const content = fs.readFileSync(cacheFilePath, 'utf-8');
		const cached = JSON.parse(content);

		return Date.now() < cached.expiresAt;
	} catch {
		return false;
	}
}

/**
 * Main execution
 */
async function main() {
	// Skip if in CI environment (don't spam models.dev API)
	if (process.env.CI === 'true') {
		console.log('ℹ️  Skipping models.dev fetch in CI environment');
		return;
	}

	// Check if cache is still valid
	if (isCacheValid()) {
		console.log('✅ Models cache is still valid, skipping fetch');
		return;
	}

	// Fetch and cache models data
	const data = await fetchModels();

	if (data) {
		writeCache(data);
	} else {
		console.log('ℹ️  Installation will continue without model metadata cache');
		console.log('ℹ️  Model metadata will be fetched on first use');
	}
}

// Run the script
main().catch(error => {
	// Don't fail the installation if this script fails
	console.error('⚠️  Post-install script error:', error.message);
	process.exit(0); // Exit with success to not break installation
});
