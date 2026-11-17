import {existsSync, readFileSync, statSync} from 'node:fs';
import {resolve, sep} from 'node:path';
import {getConfigPath} from '@/config/paths';
import {notifyError} from '@/utils/message-queue-core';
import {stripUtf8Bom} from '@/utils/strip-utf8-bom';

type ConfigFileCacheEntry =
	| {
			mtimeMs: number;
			size: number;
			ok: true;
			data: unknown;
	  }
	| {
			mtimeMs: number;
			size: number;
			ok: false;
			error: unknown;
	  };

const configFileCache = new Map<string, ConfigFileCacheEntry>();

export function clearConfigFileCache(): void {
	configFileCache.clear();
}

function isGlobalConfig(configPath: string): boolean {
	const globalDir = resolve(getConfigPath()); // nosemgrep
	const resolvedConfig = resolve(configPath); // nosemgrep
	const globalPrefix = globalDir.endsWith(sep) ? globalDir : globalDir + sep;
	return resolvedConfig.startsWith(globalPrefix);
}

/**
 * Read and cache a JSON config file.
 * Handles UTF-8 BOM, deduplicates parse error reporting, and re-parses only when mtime or size changes.
 * Returns the parsed data or null on missing file / parse error.
 */
export function readCachedConfigFile(configPath: string): unknown {
	if (!existsSync(configPath)) {
		return null;
	}

	let stats: ReturnType<typeof statSync>;
	try {
		stats = statSync(configPath);
	} catch {
		return null;
	}

	const cached = configFileCache.get(configPath);

	if (
		cached &&
		cached.mtimeMs === stats.mtimeMs &&
		cached.size === stats.size
	) {
		if (cached.ok) {
			return structuredClone(cached.data);
		}
		return null;
	}

	try {
		const data: unknown = JSON.parse(
			stripUtf8Bom(readFileSync(configPath, 'utf-8')),
		);

		configFileCache.set(configPath, {
			mtimeMs: stats.mtimeMs,
			size: stats.size,
			ok: true,
			data: structuredClone(data),
		});

		return data;
	} catch (error) {
		const isGlobal = isGlobalConfig(configPath);
		const skipLabel = isGlobal
			? 'global config skipped'
			: 'project config skipped';
		notifyError(
			`Failed to load config from ${configPath}: ${String(error)} — ${skipLabel}`,
		);

		configFileCache.set(configPath, {
			mtimeMs: stats.mtimeMs,
			size: stats.size,
			ok: false,
			error,
		});

		return null;
	}
}
