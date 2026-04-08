import {getAppConfig} from '@/config/index';

/**
 * Check if a nanocoder tool is configured to always be allowed.
 * Checks both nanocoderTools.alwaysAllow and the top-level alwaysAllow list.
 * @param toolName - The name of the tool to check
 * @returns true if the tool is in either alwaysAllow list, false otherwise
 */
export function isNanocoderToolAlwaysAllowed(toolName: string): boolean {
	const config = getAppConfig();

	// Check nanocoderTools.alwaysAllow (primary location)
	const toolsAlwaysAllow = config.nanocoderTools?.alwaysAllow;
	if (Array.isArray(toolsAlwaysAllow) && toolsAlwaysAllow.includes(toolName)) {
		return true;
	}

	// Check top-level alwaysAllow (also applies to interactive mode)
	const topLevelAlwaysAllow = config.alwaysAllow;
	if (
		Array.isArray(topLevelAlwaysAllow) &&
		topLevelAlwaysAllow.includes(toolName)
	) {
		return true;
	}

	return false;
}

/**
 * Get the Brave Search API key from config, if configured.
 * Returns undefined when no key is set (web_search tool should be disabled).
 */
export function getBraveSearchApiKey(): string | undefined {
	const apiKey = getAppConfig().nanocoderTools?.webSearch?.apiKey;
	return apiKey?.trim() || undefined;
}
