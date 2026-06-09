import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {getConfigPath} from '@/config/paths';
import {logError} from '@/utils/message-queue';

/**
 * Reads the global agents.config.json, merges the given partial update into the
 * `nanocoder` key, and writes it back. Creates the file if it doesn't exist.
 *
 * This is the write counterpart to the various `load*` functions in config/index.ts.
 */
export function updateConfigValue<K extends string, V>(
	nanocoderKey: K,
	value: V,
): void {
	const configPath = getGlobalConfigPath();
	let config: Record<string, unknown> = {};

	try {
		if (existsSync(configPath)) {
			const data = readFileSync(configPath, 'utf-8');
			config = JSON.parse(data);
		}
	} catch (error) {
		logError(`Failed to read config for update: ${String(error)}`);
		return;
	}

	if (!config.nanocoder || typeof config.nanocoder !== 'object') {
		config.nanocoder = {};
	}

	(config.nanocoder as Record<string, unknown>)[nanocoderKey] = value;

	try {
		const dir = dirname(configPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, {recursive: true});
		}
		writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
	} catch (error) {
		logError(`Failed to write config update: ${String(error)}`);
	}
}

/**
 * Reads a specific value from the global agents.config.json under the nanocoder key.
 */
export function getConfigValue<T = unknown>(
	nanocoderKey: string,
): T | undefined {
	const configPath = getGlobalConfigPath();
	try {
		if (!existsSync(configPath)) {
			return undefined;
		}
		const data = readFileSync(configPath, 'utf-8');
		const config = JSON.parse(data);
		return (config.nanocoder as Record<string, unknown>)?.[nanocoderKey] as
			| T
			| undefined;
	} catch (error) {
		logError(`Failed to read config value: ${String(error)}`);
		return undefined;
	}
}

/**
 * Reads a nested value from the global agents.config.json.
 * Example: getConfigNestedValue('autoCompact', 'threshold') reads nanocoder.autoCompact.threshold
 */
export function getConfigNestedValue<T = unknown>(
	parentKey: string,
	childKey: string,
): T | undefined {
	const configPath = getGlobalConfigPath();
	try {
		if (!existsSync(configPath)) {
			return undefined;
		}
		const data = readFileSync(configPath, 'utf-8');
		const config = JSON.parse(data);
		const parent = (config.nanocoder as Record<string, unknown>)?.[parentKey];
		if (parent && typeof parent === 'object') {
			return (parent as Record<string, unknown>)?.[childKey] as T | undefined;
		}
		return undefined;
	} catch (error) {
		logError(`Failed to read nested config value: ${String(error)}`);
		return undefined;
	}
}

/**
 * Updates a nested value in the global agents.config.json.
 * Example: updateConfigNestedValue('autoCompact', 'threshold', 75)
 */
export function updateConfigNestedValue<K extends string, V>(
	parentKey: K,
	childKey: string,
	value: V,
): void {
	const configPath = getGlobalConfigPath();
	let config: Record<string, unknown> = {};

	try {
		if (existsSync(configPath)) {
			const data = readFileSync(configPath, 'utf-8');
			config = JSON.parse(data);
		}
	} catch (error) {
		logError(`Failed to read config for nested update: ${String(error)}`);
		return;
	}

	if (!config.nanocoder || typeof config.nanocoder !== 'object') {
		config.nanocoder = {};
	}

	const nanocoder = config.nanocoder as Record<string, unknown>;
	if (!nanocoder[parentKey] || typeof nanocoder[parentKey] !== 'object') {
		nanocoder[parentKey] = {};
	}

	(nanocoder[parentKey] as Record<string, unknown>)[childKey] = value;

	try {
		const dir = dirname(configPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, {recursive: true});
		}
		writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
	} catch (error) {
		logError(`Failed to write nested config update: ${String(error)}`);
	}
}

/**
 * Updates an entire nested object in the global agents.config.json.
 * Example: updateConfigObject('autoCompact', {enabled: true, threshold: 70, ...})
 */
export function updateConfigObject<
	K extends string,
	V extends Record<string, unknown>,
>(parentKey: K, value: V): void {
	const configPath = getGlobalConfigPath();
	let config: Record<string, unknown> = {};

	try {
		if (existsSync(configPath)) {
			const data = readFileSync(configPath, 'utf-8');
			config = JSON.parse(data);
		}
	} catch (error) {
		logError(`Failed to read config for object update: ${String(error)}`);
		return;
	}

	if (!config.nanocoder || typeof config.nanocoder !== 'object') {
		config.nanocoder = {};
	}

	(config.nanocoder as Record<string, unknown>)[parentKey] = value;

	try {
		const dir = dirname(configPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, {recursive: true});
		}
		writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
	} catch (error) {
		logError(`Failed to write config object update: ${String(error)}`);
	}
}

function getGlobalConfigPath(): string {
	const configDir = getConfigPath();
	return join(configDir, 'agents.config.json');
}
