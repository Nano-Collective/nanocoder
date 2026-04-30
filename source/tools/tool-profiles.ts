import type {ToolProfile} from '@/types/config';

/**
 * Static tool subsets for /tune.
 * MCP tools are excluded from all profiles except 'full'.
 */
const TOOL_PROFILES: Record<ToolProfile, string[]> = {
	full: [], // Empty means no filtering — all tools allowed
	minimal: [
		'read_file',
		'write_file',
		'string_replace',
		'execute_bash',
		'find_files',
		'search_file_contents',
		'list_directory',
		'agent',
	],
	nano: [
		'read_file',
		'string_replace',
		'write_file',
		'execute_bash',
		'search_file_contents',
	],
};

export const TOOL_PROFILE_DESCRIPTIONS: Record<ToolProfile, string> = {
	full: 'All tools including MCP (default)',
	minimal:
		'Core editing, bash, and exploration tools — slim prompt, single-tool mode enabled automatically',
	nano: 'Strictest budget — 5 tools, ultra-slim prompt. For low-end hardware running larger models.',
};

export const TOOL_PROFILE_TOOLTIPS: Record<ToolProfile, string> = {
	full: 'No filtering. All registered tools including MCP servers.',
	minimal:
		'8 core tools (edit, bash, search, agent) with slim prompt and single-tool enforcement. Recommended for small models.',
	nano: '5 tools (read, edit, write, bash, search) with an ultra-slim prompt and single-tool enforcement. AGENTS.md is omitted from the system prompt by default. Recommended for tiny models or low-end hardware.',
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
 * Minimal and nano profiles automatically enforce one tool per response.
 */
export function isSingleToolProfile(profile: ToolProfile): boolean {
	return profile === 'minimal' || profile === 'nano';
}

/**
 * Whether a profile uses the ultra-slim prompt (drops core-principles,
 * coding-practices, uses shortened task-approach/file-editing/constraints,
 * shortened SYSTEM INFORMATION).
 */
export function isNanoProfile(profile: ToolProfile): boolean {
	return profile === 'nano';
}
