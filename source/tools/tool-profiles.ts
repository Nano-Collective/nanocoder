import type {ToolProfile} from '@/types/config';

/**
 * Static tool subsets for /tune.
 * MCP tools are excluded from all profiles except 'full'.
 */
const TOOL_PROFILES: Record<ToolProfile, string[]> = {
	full: [], // Empty means no filtering — all tools allowed
	minimal: ['read_file', 'string_replace', 'execute_bash'],
};

export const TOOL_PROFILE_DESCRIPTIONS: Record<ToolProfile, string> = {
	full: 'All tools including MCP (default)',
	minimal:
		'Read, edit, and bash only — slim prompt, single-tool mode enabled automatically',
};

export const TOOL_PROFILE_TOOLTIPS: Record<ToolProfile, string> = {
	full: 'No filtering. All registered tools including MCP servers.',
	minimal:
		'3 essential tools with slim prompt and single-tool enforcement. Recommended for small models.',
};

/**
 * Get the allowed tool names for a given profile.
 * Returns empty array for 'full' profile (meaning no filtering).
 */
export function getToolsForProfile(profile: ToolProfile): string[] {
	return TOOL_PROFILES[profile];
}

/**
 * Whether a profile implies single-tool mode.
 * Minimal profile automatically enforces one tool per response.
 */
export function isSingleToolProfile(profile: ToolProfile): boolean {
	return profile === 'minimal';
}
