import {getAppConfig} from '@/config/index';

/**
 * Check if a nanocoder tool is configured to always be allowed
 * @param toolName - The name of the tool to check
 * @returns true if the tool is in the alwaysAllow list, false otherwise
 */
export function isNanocoderToolAlwaysAllowed(toolName: string): boolean {
	const alwaysAllowList = getAppConfig().nanocoderTools?.alwaysAllow;

	if (!Array.isArray(alwaysAllowList)) {
		return false;
	}

	return alwaysAllowList.includes(toolName);
}

/**
 * Get the Brave Search API key from config, if configured.
 * Returns undefined when no key is set (web_search tool should be disabled).
 */
export function getBraveSearchApiKey(): string | undefined {
	const apiKey = getAppConfig().nanocoderTools?.webSearch?.apiKey;
	return apiKey?.trim() || undefined;
}
