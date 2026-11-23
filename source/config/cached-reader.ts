import {readFileSync, statSync} from 'node:fs';
import {stripUtf8Bom} from '@/utils/strip-utf8-bom';

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

	const data: unknown = JSON.parse(
		stripUtf8Bom(readFileSync(configPath, 'utf-8')),
	);

	configFileCache.set(configPath, {
		mtimeMs: stats.mtimeMs,
		size: stats.size,
		data: structuredClone(data),
	});

	return data;
}
