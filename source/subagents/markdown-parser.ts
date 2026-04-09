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
	const frontmatter = extractFrontmatter(content);
	const systemPrompt = extractBody(content);

	const config: SubagentConfig = {
		name: frontmatter.name,
		description: frontmatter.description,
		provider: frontmatter.provider,
		model: frontmatter.model || 'inherit',
		tools: frontmatter.tools,
		disallowedTools: frontmatter.disallowedTools,
		systemPrompt,
	};

	return {
		config,
		filePath,
		priority: priority ?? 1,
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
 * Extract YAML frontmatter from markdown content.
 */
export function extractFrontmatter(content: string): SubagentFrontmatter {
	const match = content.match(/^---\r?\n(.*?)\r?\n---/s);

	if (!match) {
		throw new Error('No YAML frontmatter found in file');
	}

	let frontmatter: Record<string, unknown>;

	try {
		frontmatter = parseYaml(match[1]) as Record<string, unknown>;
	} catch (error) {
		throw new Error(`Failed to parse YAML frontmatter: ${error}`);
	}

	if (!frontmatter || typeof frontmatter !== 'object') {
		throw new Error('YAML frontmatter must be an object');
	}

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
	const withoutFrontmatter = content.replace(
		/^---\r?\n.*?\r?\n---(?:\r?\n|$)/s,
		'',
	);
	return withoutFrontmatter.trim();
}
