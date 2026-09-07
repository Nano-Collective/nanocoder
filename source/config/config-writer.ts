import {existsSync, readFileSync} from 'node:fs';
import {getClosestConfigFile} from '@/config/index';
import type {UserPreferences} from '@/types/config';
import {atomicWriteJson} from '@/utils/atomic-write';
import {logError} from '@/utils/message-queue';

/**
 * Reads the active agents.config.json, merges the given partial update into the
 * `nanocoder` key, and writes it back atomically. Creates the file if missing.
 * The write counterpart to the various `load*` functions in config/index.ts.
 */
export function updateConfigValue<K extends string, V>(
	nanocoderKey: K,
	value: V,
): void {
	const configPath = getActiveConfigPath();
	const config = readConfigObject(configPath);
	if (!config) return;

	if (!config.nanocoder || typeof config.nanocoder !== 'object') {
		config.nanocoder = {};
	}
	(config.nanocoder as Record<string, unknown>)[nanocoderKey] = value;
	writeConfigObject(configPath, config, 'update');
}

/**
 * Shared read-modify-write for a nested `nanocoder.<parent>.<child>` value.
 * Reads the whole config file, merges the change, and writes it back atomically
 * so a crash can never leave a truncated file.
 */
function updateNestedValue(
	configPath: string,
	parentKey: string,
	childKey: string,
	value: unknown,
): void {
	const config = readConfigObject(configPath);
	if (!config) return;

	if (!config.nanocoder || typeof config.nanocoder !== 'object') {
		config.nanocoder = {};
	}
	const nanocoder = config.nanocoder as Record<string, unknown>;
	if (!nanocoder[parentKey] || typeof nanocoder[parentKey] !== 'object') {
		nanocoder[parentKey] = {};
	}
	(nanocoder[parentKey] as Record<string, unknown>)[childKey] = value;
	writeConfigObject(configPath, config, 'nested update');
}

/**
 * Updates a nested value in agents.config.json:
 * updateConfigNestedValue('autoCompact', 'threshold', 75).
 */
export function updateConfigNestedValue<K extends string, V>(
	parentKey: K,
	childKey: string,
	value: V,
): void {
	updateNestedValue(getActiveConfigPath(), parentKey, childKey, value);
}

type PreferencesNanocoder = NonNullable<UserPreferences['nanocoder']>;

/**
 * Resolve the active nanocoder-preferences.json, merge the given nested value
 * into the `nanocoder.<parentKey>.<childKey>` path, and write it back
 * atomically. Creates the file if missing. The write counterpart to the
 * `loadSessionConfig` / `loadPasteConfig` loaders, which read the same
 * namespaced shape from nanocoder-preferences.json.
 */
export function updatePreferencesNestedValue<
	K extends keyof PreferencesNanocoder,
	N extends keyof NonNullable<PreferencesNanocoder[K]>,
>(
	parentKey: K,
	childKey: N,
	value: NonNullable<PreferencesNanocoder[K]>[N],
): void {
	updateNestedValue(
		getClosestConfigFile('nanocoder-preferences.json'),
		parentKey as string,
		childKey as string,
		value,
	);
}

/**
 * Atomically write an arbitrary config file with pretty-printed JSON. Used by the
 * in-TUI JSON editor so a crash mid-write can never leave a truncated config.
 */
export function writeConfigFileAtomic(filePath: string, data: unknown): void {
	atomicWriteJson(filePath, data);
}

function readConfigObject(
	configPath: string,
): Record<string, unknown> | undefined {
	try {
		if (existsSync(configPath)) {
			return JSON.parse(readFileSync(configPath, 'utf-8'));
		}
		return {};
	} catch (error) {
		logError(`Failed to read config for update: ${String(error)}`);
		return undefined;
	}
}

function writeConfigObject(
	configPath: string,
	config: Record<string, unknown>,
	label: string,
): void {
	try {
		writeConfigFileAtomic(configPath, config);
	} catch (error) {
		logError(`Failed to write config ${label}: ${String(error)}`);
	}
}

/**
 * Same resolution the loaders use (project agents.config.json shadows the user
 * one). Writing to the global file unconditionally meant a project config
 * silently shadowed every settings change on the next launch.
 */
function getActiveConfigPath(): string {
	return getClosestConfigFile('agents.config.json');
}
