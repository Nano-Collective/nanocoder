import {readFileSync, statSync} from 'node:fs';

interface ConfigFileCacheEntry {
	mtimeMs: number;
	size: number;
	data: unknown;
}

const configFileCache = new Map<string, ConfigFileCacheEntry>();

export function clearConfigFileCache(): void {
	configFileCache.clear();
}

/**
 * Read and cache a JSON config file.
 * Handles UTF-8 BOM and re-parses only when mtime or size changes.
 * Throws SyntaxError on malformed JSON so callers can report it.
 */
export function readCachedConfigFile(configPath: string): unknown {
	const stats = statSync(configPath);
	const cached = configFileCache.get(configPath);

	if (
		cached &&
		cached.mtimeMs === stats.mtimeMs &&
		cached.size === stats.size
	) {
		return structuredClone(cached.data);
	}

	const raw = readFileSync(configPath, 'utf-8');
	const clean = raw.replace(/^\uFEFF/, '');
	const data: unknown = JSON.parse(clean);

	configFileCache.set(configPath, {
		mtimeMs: stats.mtimeMs,
		size: stats.size,
		data: structuredClone(data),
	});

	return data;
}
