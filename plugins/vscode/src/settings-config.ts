export type SettingsMode = 'normal' | 'auto-accept' | 'yolo' | 'plan';

export const SETTINGS_MODES: readonly SettingsMode[] = [
	'normal',
	'auto-accept',
	'yolo',
	'plan'
];

export const THRESHOLD_MIN = 50;
export const THRESHOLD_MAX = 95;

export interface GeneralSettings {
	defaultMode: SettingsMode;
	autoCompactEnabled: boolean;
	autoCompactThreshold: number;
}

export interface SettingsSnapshot {
	general: GeneralSettings;
	providers: { name: string; models: number }[];
	mcpServers: { name: string }[];
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
	defaultMode: 'normal',
	autoCompactEnabled: true,
	autoCompactThreshold: 60
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function child(parent: JsonObject, key: string): JsonObject {
	const value = parent[key];
	return isObject(value) ? value : {};
}

export function parseConfig(text: string): JsonObject {
	const trimmed = text.trim();
	if (!trimmed) {
		return {};
	}
	const parsed = JSON.parse(trimmed);
	if (!isObject(parsed)) {
		throw new Error('agents.config.json must contain a JSON object.');
	}
	return parsed;
}

export function serialiseConfig(config: JsonObject): string {
	return `${JSON.stringify(config, null, '\t')}\n`;
}

export function clampThreshold(value: unknown): number {
	const numeric = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(numeric)) {
		return DEFAULT_GENERAL_SETTINGS.autoCompactThreshold;
	}
	return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, Math.round(numeric)));
}

function toMode(value: unknown): SettingsMode {
	if (typeof value === 'string') {
		const normalised = value.toLowerCase().trim();
		if ((SETTINGS_MODES as readonly string[]).includes(normalised)) {
			return normalised as SettingsMode;
		}
	}
	return DEFAULT_GENERAL_SETTINGS.defaultMode;
}

export function normaliseGeneralSettings(input: unknown): GeneralSettings {
	const source = isObject(input) ? input : {};
	return {
		defaultMode: toMode(source.defaultMode),
		autoCompactEnabled:
			source.autoCompactEnabled === undefined
				? DEFAULT_GENERAL_SETTINGS.autoCompactEnabled
				: Boolean(source.autoCompactEnabled),
		autoCompactThreshold:
			source.autoCompactThreshold === undefined
				? DEFAULT_GENERAL_SETTINGS.autoCompactThreshold
				: clampThreshold(source.autoCompactThreshold)
	};
}

export function readSettings(config: JsonObject): SettingsSnapshot {
	const nanocoder = child(config, 'nanocoder');
	const autoCompact = child(nanocoder, 'autoCompact');

	const providers = Array.isArray(config.providers) ? config.providers : [];
	const mcpServers = Array.isArray(config.mcpServers) ? config.mcpServers : [];

	return {
		general: normaliseGeneralSettings({
			defaultMode: nanocoder.defaultMode,
			autoCompactEnabled: autoCompact.enabled,
			autoCompactThreshold: autoCompact.threshold
		}),
		providers: providers.filter(isObject).map(provider => ({
			name: typeof provider.name === 'string' ? provider.name : 'Unnamed',
			models: Array.isArray(provider.models) ? provider.models.length : 0
		})),
		mcpServers: mcpServers.filter(isObject).map(server => ({
			name: typeof server.name === 'string' ? server.name : 'Unnamed'
		}))
	};
}

export function applyGeneralSettings(
	config: JsonObject,
	settings: unknown
): JsonObject {
	const general = normaliseGeneralSettings(settings);
	const nanocoder = child(config, 'nanocoder');
	const autoCompact = child(nanocoder, 'autoCompact');

	return {
		...config,
		nanocoder: {
			...nanocoder,
			defaultMode: general.defaultMode,
			autoCompact: {
				...autoCompact,
				enabled: general.autoCompactEnabled,
				threshold: general.autoCompactThreshold
			}
		}
	};
}
