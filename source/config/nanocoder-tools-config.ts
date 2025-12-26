import {appConfig} from '@/config/index';

/**
 * Check if a nanocoder tool is configured to always be allowed
 * @param toolName - The name of the tool to check
 * @returns true if the tool is in the alwaysAllow list, false otherwise
 */
export function isNanocoderToolAlwaysAllowed(toolName: string): boolean {
	const alwaysAllowList = appConfig.nanocoderTools?.alwaysAllow;

	if (!Array.isArray(alwaysAllowList)) {
		return false;
	}

	return alwaysAllowList.includes(toolName);
}
