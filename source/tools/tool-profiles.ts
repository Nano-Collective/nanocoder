import type {ToolProfile} from '@/types/config';

/** Concrete profiles — the result of resolving 'auto'. */
type ConcreteProfile = Exclude<ToolProfile, 'auto'>;

/**
 * Static tool subsets for /tune.
 * MCP tools are excluded from all profiles except 'full'.
 */
const TOOL_PROFILES: Record<ConcreteProfile, string[]> = {
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
	auto: 'Pick the profile automatically from the active model (default)',
	full: 'All tools including MCP',
	minimal:
		'Core editing, bash, and exploration tools — slim prompt, single-tool mode enabled automatically',
	nano: 'Strictest budget — 5 tools, ultra-slim prompt. For low-end hardware running larger models.',
};

export const TOOL_PROFILE_TOOLTIPS: Record<ToolProfile, string> = {
	auto: 'Resolves from the model size: tiny models get nano, small models get minimal, larger/cloud models get full. Switching models re-resolves automatically.',
	full: 'No filtering. All registered tools including MCP servers.',
	minimal:
		'8 core tools (edit, bash, search, agent) with slim prompt and single-tool enforcement. Recommended for small models.',
	nano: '5 tools (read, edit, write, bash, search) with an ultra-slim prompt and single-tool enforcement. AGENTS.md is omitted from the system prompt by default. Recommended for tiny models or low-end hardware.',
};

/**
 * Approximate parameter count (in billions) from a model id, or null if the
 * id carries no size hint. Handles forms like "qwen2.5-coder:7b",
 * "llama3.2:1b", "deepseek-r1:1.5b", "gpt-oss:20b", and "smollm:135m".
 */
function modelParamsBillions(model: string): number | null {
	const lower = model.toLowerCase();

	// Millions suffix (e.g. 135m) — always tiny.
	const millions = lower.match(/(\d+(?:\.\d+)?)\s*m\b(?![a-z])/g);
	if (millions && millions.length > 0) {
		return 0.5; // treat any sub-billion model as tiny
	}

	// Billions suffix — take the largest match. A model's capability tracks its
	// largest declared parameter count, so for MoE ids like "qwen3-30b-a3b"
	// (30B total, 3B active) we want the 30B total, not the trailing active
	// count. For single-size tags like "qwen2.5-coder:32b" there is only one
	// match, so this is equivalent to taking it directly.
	const billions = [...lower.matchAll(/(\d+(?:\.\d+)?)\s*b\b(?![a-z])/g)];
	if (billions.length > 0) {
		return Math.max(...billions.map(m => parseFloat(m[1])));
	}

	return null;
}

/**
 * Infer a concrete profile from the active model id.
 *
 * Small local models benefit from a slim tool set and prompt; large or
 * cloud-hosted models (no size hint in the id) get the full surface.
 */
export function inferToolProfile(model?: string): ConcreteProfile {
	if (!model) return 'full';

	const params = modelParamsBillions(model);
	if (params === null) return 'full'; // cloud / unknown — assume capable
	if (params <= 4) return 'nano';
	if (params <= 15) return 'minimal';
	return 'full';
}

/**
 * Resolve a (possibly 'auto') profile to a concrete one using the model.
 */
export function resolveToolProfile(
	profile: ToolProfile,
	model?: string,
): ConcreteProfile {
	return profile === 'auto' ? inferToolProfile(model) : profile;
}

/**
 * Get the allowed tool names for a given profile.
 * Returns empty array for the 'full' profile (meaning no filtering).
 */
export function getToolsForProfile(
	profile: ToolProfile,
	model?: string,
): string[] {
	return TOOL_PROFILES[resolveToolProfile(profile, model)];
}

/**
 * Whether a profile implies single-tool mode.
 * Minimal and nano profiles automatically enforce one tool per response.
 */
export function isSingleToolProfile(
	profile: ToolProfile,
	model?: string,
): boolean {
	const resolved = resolveToolProfile(profile, model);
	return resolved === 'minimal' || resolved === 'nano';
}

/**
 * Whether a profile uses the ultra-slim prompt (drops core-principles,
 * coding-practices, uses shortened task-approach/file-editing/constraints,
 * shortened SYSTEM INFORMATION).
 */
export function isNanoProfile(profile: ToolProfile, model?: string): boolean {
	return resolveToolProfile(profile, model) === 'nano';
}
