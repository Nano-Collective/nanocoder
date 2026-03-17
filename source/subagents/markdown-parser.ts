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
 * tools: [Read, Grep]
 * ---
 *
 * You are a specialized agent...
 * ```
 */

import * as fs from 'node:fs/promises';
import type {
	ParsedSubagentFile,
	SubagentConfig,
	SubagentFrontmatter,
	SubagentLoadPriority,
} from './types.js';

/**
 * Parse a subagent definition from a markdown file.
 * @param filePath - Path to the markdown file
 * @param priority - Priority level for this config
 * @returns Parsed subagent configuration
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
		model: frontmatter.model || 'inherit',
		tools: frontmatter.tools,
		disallowedTools: frontmatter.disallowedTools,
		permissionMode: frontmatter.permissionMode || 'normal',
		mcpServers: frontmatter.mcpServers,
		maxTurns: frontmatter.maxTurns,
		systemPrompt,
	};

	return {
		config,
		filePath,
		priority: priority ?? 1, // Default to user priority
	};
}

/**
 * Validate a subagent frontmatter object.
 * @param frontmatter - The frontmatter to validate
 * @returns Valid status with optional error message
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
		const validModels = ['haiku', 'sonnet', 'opus', 'inherit'];
		if (!validModels.includes(frontmatter.model as string)) {
			return {
				valid: false,
				error: `model must be one of: ${validModels.join(', ')}`,
			};
		}
	}

	if (frontmatter.permissionMode !== undefined) {
		const validModes = ['readOnly', 'normal', 'autoAccept'];
		if (!validModes.includes(frontmatter.permissionMode as string)) {
			return {
				valid: false,
				error: `permissionMode must be one of: ${validModes.join(', ')}`,
			};
		}
	}

	if (frontmatter.maxTurns !== undefined) {
		if (
			typeof frontmatter.maxTurns !== 'number' ||
			frontmatter.maxTurns < 1 ||
			!Number.isInteger(frontmatter.maxTurns)
		) {
			return {
				valid: false,
				error: 'maxTurns must be a positive integer',
			};
		}
	}

	return {valid: true};
}

/**
 * Extract YAML frontmatter from markdown content.
 * @param content - The markdown file content
 * @returns Parsed frontmatter object
 */
export function extractFrontmatter(content: string): SubagentFrontmatter {
	const match = content.match(/^---\n(.*?)\n---/s);

	if (!match) {
		throw new Error('No YAML frontmatter found in file');
	}

	let frontmatter: Record<string, unknown>;

	try {
		// Try to parse as YAML
		// We use a simple YAML parser for now that handles basic types
		frontmatter = parseSimpleYaml(match[1]);
	} catch (error) {
		throw new Error(`Failed to parse YAML frontmatter: ${error}`);
	}

	const validation = validateFrontmatter(frontmatter);
	if (!validation.valid) {
		throw new Error(`Invalid frontmatter: ${validation.error}`);
	}

	return frontmatter as unknown as SubagentFrontmatter;
}

/**
 * Extract the body content from markdown (after frontmatter).
 * @param content - The markdown file content
 * @returns The body content as the system prompt
 */
export function extractBody(content: string): string {
	// Remove frontmatter (with or without trailing newline after closing ---)
	const withoutFrontmatter = content.replace(/^---\n.*?\n---(?:\n|$)/s, '');
	return withoutFrontmatter.trim();
}

/**
 * Simple YAML parser for basic frontmatter.
 * Handles strings, numbers, booleans, arrays, and null.
 * This is a simplified parser - for complex YAML, consider using a library.
 */
function parseSimpleYaml(yamlString: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = yamlString.split('\n');

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue; // Skip empty lines and comments
		}

		const colonIndex = trimmed.indexOf(':');
		if (colonIndex === -1) {
			continue; // Skip malformed lines
		}

		const key = trimmed.slice(0, colonIndex).trim();
		const valueStr = trimmed.slice(colonIndex + 1).trim();

		// Parse the value
		result[key] = parseYamlValue(valueStr);
	}

	return result;
}

/**
 * Parse a YAML value string into its JavaScript equivalent.
 */
function parseYamlValue(value: string): unknown {
	if (!value) {
		return null;
	}

	// Boolean
	if (value === 'true') return true;
	if (value === 'false') return false;
	if (value === 'null' || value === '~') return null;

	// Number
	if (/^-?\d+$/.test(value)) {
		return Number.parseInt(value, 10);
	}
	if (/^-?\d+\.\d+$/.test(value)) {
		return Number.parseFloat(value);
	}

	// Array (e.g., [item1, item2])
	if (value.startsWith('[') && value.endsWith(']')) {
		const items = value.slice(1, -1).split(',');
		return items.map(item => item.trim()).filter(item => item.length > 0);
	}

	// Quoted string
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}

	// Unquoted string
	return value;
}
