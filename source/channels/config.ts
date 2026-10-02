/**
 * Validation for the `nanocoder.channels` block of agents.config.json.
 *
 * Pure: the config loader hands in the raw (env-substituted) JSON and logs
 * whatever comes back in `warnings`. A platform block with a problem is
 * dropped rather than started half-configured, and the reason says so -
 * silently ignoring a typo in `allowedUsers` would be the worst outcome
 * here, since that list is the only thing standing between a bot token
 * and unattended tool execution.
 */

import type {
	ChannelCommonConfig,
	ChannelPlatform,
	ChannelsConfig,
	DiscordChannelConfig,
	SlackChannelConfig,
	TelegramChannelConfig,
} from '@/types/config';

const CHANNEL_PLATFORMS: readonly ChannelPlatform[] = [
	'telegram',
	'slack',
	'discord',
];

/** Earlier exchanges from the same chat carried into the next prompt. */
export const DEFAULT_CHANNEL_HISTORY_TURNS = 6;
export const MAX_CHANNEL_HISTORY_TURNS = 50;

/** How long the bridge waits for the daemon to answer one message. */
export const DEFAULT_CHANNEL_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_CHANNEL_TIMEOUT_MS = 1000;

export interface ParsedChannelsConfig {
	config: ChannelsConfig;
	warnings: string[];
}

export function parseChannelsConfig(raw: unknown): ParsedChannelsConfig {
	const warnings: string[] = [];
	const config: ChannelsConfig = {};
	if (!isRecord(raw)) {
		warnings.push('must be an object; ignoring');
		return {config, warnings};
	}

	const telegram = parsePlatform(raw.telegram, 'telegram', ['token'], warnings);
	if (telegram) {
		const block: TelegramChannelConfig = {
			...telegram.common,
			token: telegram.secrets.token,
		};
		config.telegram = block;
	}

	const slack = parsePlatform(
		raw.slack,
		'slack',
		['botToken', 'appToken'],
		warnings,
	);
	if (slack) {
		const block: SlackChannelConfig = {
			...slack.common,
			botToken: slack.secrets.botToken,
			appToken: slack.secrets.appToken,
		};
		config.slack = block;
	}

	const discord = parsePlatform(raw.discord, 'discord', ['token'], warnings);
	if (discord) {
		const block: DiscordChannelConfig = {
			...discord.common,
			token: discord.secrets.token,
		};
		config.discord = block;
	}

	if (raw.historyTurns !== undefined) {
		const value = raw.historyTurns;
		if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
			config.historyTurns = Math.min(
				Math.round(value),
				MAX_CHANNEL_HISTORY_TURNS,
			);
		} else {
			warnings.push(
				`historyTurns must be a number >= 0 (got ${JSON.stringify(value)}); using ${DEFAULT_CHANNEL_HISTORY_TURNS}`,
			);
		}
	}

	if (raw.timeoutMs !== undefined) {
		const value = raw.timeoutMs;
		if (
			typeof value === 'number' &&
			Number.isFinite(value) &&
			value >= MIN_CHANNEL_TIMEOUT_MS
		) {
			config.timeoutMs = Math.round(value);
		} else {
			warnings.push(
				`timeoutMs must be a number >= ${MIN_CHANNEL_TIMEOUT_MS} (got ${JSON.stringify(value)}); using ${DEFAULT_CHANNEL_TIMEOUT_MS}`,
			);
		}
	}

	for (const key of Object.keys(raw)) {
		if (
			!CHANNEL_PLATFORMS.includes(key as ChannelPlatform) &&
			key !== 'historyTurns' &&
			key !== 'timeoutMs'
		) {
			warnings.push(`unknown key "${key}" ignored`);
		}
	}

	return {config, warnings};
}

/** Platforms with a usable block, in start order. */
export function configuredPlatforms(
	config: ChannelsConfig | undefined,
): ChannelPlatform[] {
	if (!config) return [];
	return CHANNEL_PLATFORMS.filter(platform => config[platform] !== undefined);
}

interface ParsedPlatform {
	secrets: Record<string, string>;
	common: ChannelCommonConfig;
}

function parsePlatform(
	raw: unknown,
	platform: ChannelPlatform,
	secretKeys: string[],
	warnings: string[],
): ParsedPlatform | null {
	if (raw === undefined) return null;
	if (!isRecord(raw)) {
		warnings.push(`${platform} must be an object; channel disabled`);
		return null;
	}

	const secrets: Record<string, string> = {};

	for (const key of secretKeys) {
		const value = raw[key];
		if (typeof value !== 'string' || value.trim() === '') {
			warnings.push(`${platform}.${key} is missing; channel disabled`);
			return null;
		}
		if (/^\$\{?[A-Za-z_]/.test(value)) {
			// Substitution already ran, so a literal `${VAR}` means the variable
			// was unset. Starting with that string as the token would only
			// produce an opaque 401 from the platform.
			warnings.push(
				`${platform}.${key} still reads "${value}" - is the environment variable set? Channel disabled`,
			);
			return null;
		}
		secrets[key] = value.trim();
	}

	const allowedUsers = idList(
		raw.allowedUsers,
		`${platform}.allowedUsers`,
		warnings,
	);
	if (allowedUsers.length === 0) {
		warnings.push(
			`${platform}.allowedUsers is empty; channel disabled (anyone who found the bot could otherwise run tools on this machine)`,
		);
		return null;
	}
	const common: ChannelCommonConfig = {allowedUsers};

	if (raw.allowedChats !== undefined) {
		common.allowedChats = idList(
			raw.allowedChats,
			`${platform}.allowedChats`,
			warnings,
		);
	}

	if (raw.mode !== undefined) {
		if (raw.mode === 'headless' || raw.mode === 'plan') {
			common.mode = raw.mode;
		} else {
			warnings.push(
				`${platform}.mode must be "headless" or "plan" (got ${JSON.stringify(raw.mode)}); using headless`,
			);
		}
	}

	return {secrets, common};
}

/**
 * Ids as the platforms report them are strings, but Telegram and Discord
 * ids look numeric and people write them as numbers. Accept both.
 */
function idList(raw: unknown, label: string, warnings: string[]): string[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		warnings.push(`${label} must be an array of ids`);
		return [];
	}
	const ids: string[] = [];
	for (const item of raw) {
		if (typeof item === 'string' && item.trim() !== '') {
			ids.push(item.trim());
		} else if (typeof item === 'number' && Number.isFinite(item)) {
			ids.push(String(item));
		} else {
			warnings.push(`${label} entry ${JSON.stringify(item)} ignored`);
		}
	}
	return ids;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
