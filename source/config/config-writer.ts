import {randomUUID} from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import {dirname, join} from 'node:path';
import {getConfigPath} from '@/config/paths';
import {logError} from '@/utils/message-queue';

/**
 * Reads the global agents.config.json, merges the given partial update into the
 * `nanocoder` key, and writes it back atomically. Creates the file if missing.
 * The write counterpart to the various `load*` functions in config/index.ts.
 */
export function updateConfigValue<K extends string, V>(
	nanocoderKey: K,
	value: V,
): void {
	const configPath = getGlobalConfigPath();
	const config = readConfigObject(configPath);
	if (!config) return;

	if (!config.nanocoder || typeof config.nanocoder !== 'object') {
		config.nanocoder = {};
	}
	(config.nanocoder as Record<string, unknown>)[nanocoderKey] = value;
	writeConfigObject(configPath, config, 'update');
}

/**
 * Updates a nested value: updateConfigNestedValue('autoCompact', 'threshold', 75).
 */
export function updateConfigNestedValue<K extends string, V>(
	parentKey: K,
	childKey: string,
	value: V,
): void {
	const configPath = getGlobalConfigPath();
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
 * Atomically write an arbitrary config file with pretty-printed JSON. Used by the
 * in-TUI JSON editor so a crash mid-write can never leave a truncated config.
 */
export function writeConfigFileAtomic(filePath: string, data: unknown): void {
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, {recursive: true});
	}
	atomicWriteFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
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

function atomicWriteFileSync(filePath: string, data: string): void {
	const tmpPath = `${filePath}.${randomUUID()}.tmp`;
	try {
		writeFileSync(tmpPath, data, 'utf-8');
		renameSync(tmpPath, filePath);
	} catch (error) {
		try {
			unlinkSync(tmpPath);
		} catch {}
		throw error;
	}
}

function getGlobalConfigPath(): string {
	return join(getConfigPath(), 'agents.config.json');
}
