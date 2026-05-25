/**
 * Subagent Markdown Parser
 *
 * Parses subagent definitions from markdown files with YAML frontmatter.
 * Format:
 * ```yaml
 * ---
 * name: my-agent
 * description: Description of when to use
 * model: haiku
 * tools:
 *   - Read
 *   - Grep
 * ---
 *
 * You are a specialized agent...
 * ```
 */

import * as fs from 'node:fs/promises';
import {parse as parseYaml} from 'yaml';
import {parseSubscribeBlock} from '@/skills/parse-subscribe';
import type {SkillTrigger} from '@/types/skills';
import {splitFrontmatter} from '@/utils/frontmatter';
import type {
	ParsedSubagentFile,
	SubagentConfig,
	SubagentFrontmatter,
	SubagentLoadPriority,
} from './types.js';

/**
 * Parse a subagent definition from a markdown file.
 */
export async function parseSubagentMarkdown(
	filePath: string,
	priority?: SubagentLoadPriority,
): Promise<ParsedSubagentFile> {
	const content = await fs.readFile(filePath, 'utf-8');
	const raw = extractRawFrontmatter(content);
	const frontmatter = validateAndCastFrontmatter(raw);
	const systemPrompt = extractBody(content);

	const config: SubagentConfig = {
		name: frontmatter.name,
		description: frontmatter.description,
		provider: frontmatter.provider,
		model: frontmatter.model || 'inherit',
		contextWindow: frontmatter.contextWindow,
		tools: frontmatter.tools,
		disallowedTools: frontmatter.disallowedTools,
		systemPrompt,
	};

	const subscribe: SkillTrigger[] | undefined = parseSubscribeBlock(
		raw.subscribe,
	);

	return {
		config,
		filePath,
		priority: priority ?? 1,
		subscribe,
	};
}

/**
 * Validate a subagent frontmatter object.
 */
export function validateFrontmatter(
	frontmatter: Record<string, unknown>,
): {valid: true} | {valid: false; error: string} {
	if (typeof frontmatter.name !== 'string' || !frontmatter.name.trim()) {
		return {
			valid: false,
			error: 'name is required and must be a non-empty string',
		};
	}

	if (
		typeof frontmatter.description !== 'string' ||
		!frontmatter.description.trim()
	) {
		return {
			valid: false,
			error: 'description is required and must be a non-empty string',
		};
	}

	if (frontmatter.model !== undefined) {
		if (typeof frontmatter.model !== 'string' || !frontmatter.model.trim()) {
			return {
				valid: false,
				error: 'model must be a non-empty string (a model ID or "inherit")',
			};
		}
	}

	if (frontmatter.contextWindow !== undefined) {
		if (
			typeof frontmatter.contextWindow !== 'number' ||
			!Number.isFinite(frontmatter.contextWindow) ||
			frontmatter.contextWindow <= 0
		) {
			return {
				valid: false,
				error: 'contextWindow must be a positive number',
			};
		}
	}

	if (frontmatter.tools !== undefined) {
		if (!Array.isArray(frontmatter.tools)) {
			return {
				valid: false,
				error: 'tools must be an array of strings',
			};
		}
	}

	if (frontmatter.disallowedTools !== undefined) {
		if (!Array.isArray(frontmatter.disallowedTools)) {
			return {
				valid: false,
				error: 'disallowedTools must be an array of strings',
			};
		}
	}

	return {valid: true};
}

/**
 * Extract YAML frontmatter from markdown content and validate the subagent
 * fields. Returns the typed `SubagentFrontmatter` (unknown fields like
 * `subscribe:` are dropped).
 */
export function extractFrontmatter(content: string): SubagentFrontmatter {
	return validateAndCastFrontmatter(extractRawFrontmatter(content));
}

/**
 * Parse YAML frontmatter as an untyped record. Used by callers that need to
 * read fields outside the subagent schema (e.g. `subscribe:`).
 */
function extractRawFrontmatter(content: string): Record<string, unknown> {
	const {frontmatter: raw, hasFrontmatter} = splitFrontmatter(content);
	if (!hasFrontmatter) {
		throw new Error('No YAML frontmatter found in file');
	}

	let frontmatter: Record<string, unknown>;
	try {
		frontmatter = parseYaml(raw) as Record<string, unknown>;
	} catch (error) {
		throw new Error(`Failed to parse YAML frontmatter: ${error}`);
	}

	if (!frontmatter || typeof frontmatter !== 'object') {
		throw new Error('YAML frontmatter must be an object');
	}

	return frontmatter;
}

function validateAndCastFrontmatter(
	frontmatter: Record<string, unknown>,
): SubagentFrontmatter {
	const validation = validateFrontmatter(frontmatter);
	if (!validation.valid) {
		throw new Error(`Invalid frontmatter: ${validation.error}`);
	}
	return frontmatter as unknown as SubagentFrontmatter;
}

/**
 * Extract the body content from markdown (after frontmatter).
 */
export function extractBody(content: string): string {
	return splitFrontmatter(content).body;
}
