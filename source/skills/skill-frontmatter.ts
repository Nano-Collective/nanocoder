import type {SkillMetadata} from '@/types/skill';

export interface SkillFrontmatter extends SkillMetadata {
	version?: string;
	author?: string;
	examples?: string[];
	references?: string[];
	dependencies?: string[];
}

/**
 * Parse YAML-like frontmatter for SKILL.md.
 * Handles: name, description, category, allowed-tools, tags, triggers,
 * estimated-tokens, version, author, examples, references, dependencies.
 *
 * Supported syntax:
 * - Simple key: value pairs
 * - Quoted values: key: "value with: colon" or key: 'value with: colon'
 * - Array values: key: [item1, item2] or key:\n  - item1\n  - item2
 * - Numbers: key: 123
 *
 * Limitations (not supported):
 * - Multi-line values (use quotes)
 * - Nested objects
 * - Escape sequences
 */
export function parseSkillFrontmatter(
	raw: string,
	skillId: string,
): SkillFrontmatter | null {
	const meta: Record<string, unknown> = {id: skillId};
	const lines = raw.split('\n');
	let currentKey: string | null = null;
	const arrayKeys = new Set([
		'allowed-tools',
		'tags',
		'triggers',
		'examples',
		'references',
		'dependencies',
	]);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		if (trimmed.startsWith('- ') && currentKey) {
			const item = trimmed
				.slice(2)
				.trim()
				.replace(/^["']|["']$/g, '');
			const arr = (meta[currentKey] as string[]) ?? [];
			arr.push(item);
			meta[currentKey] = arr;
			continue;
		}

		const colonIdx = findColonOutsideQuotes(trimmed);
		if (colonIdx === -1) continue;

		const key = trimmed.slice(0, colonIdx).trim();
		const rawValue = trimmed.slice(colonIdx + 1);
		const value = extractValue(rawValue);

		if (arrayKeys.has(key)) {
			currentKey = key;
			if (value) {
				const parsed = parseArrayValue(value);
				if (parsed.length > 0) meta[key] = parsed;
			}
			continue;
		}

		currentKey = null;
		if (value) {
			const num = Number(value);
			meta[key] = Number.isNaN(num) ? value : num;
		}
	}

	const name = meta.name as string | undefined;
	const description = meta.description as string | undefined;
	if (!name || !description) {
		return null;
	}

	return {
		id: skillId,
		name,
		description,
		category: (meta.category as string) ?? 'general',
		allowedTools: meta['allowed-tools'] as string[] | undefined,
		tags: meta.tags as string[] | undefined,
		triggers: meta.triggers as string[] | undefined,
		estimatedTokens:
			typeof meta['estimated-tokens'] === 'number'
				? meta['estimated-tokens']
				: undefined,
		version: meta.version as string | undefined,
		author: meta.author as string | undefined,
		examples: meta.examples as string[] | undefined,
		references: meta.references as string[] | undefined,
		dependencies: meta.dependencies as string[] | undefined,
	};
}

function findColonOutsideQuotes(line: string): number {
	let inSingleQuote = false;
	let inDoubleQuote = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];

		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
		} else if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
		} else if (char === ':' && !inSingleQuote && !inDoubleQuote) {
			return i;
		}
	}

	return -1;
}

function extractValue(rawValue: string): string {
	const trimmed = rawValue.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseArrayValue(value: string): string[] {
	const v = value.trim();
	if (v.startsWith('[') && v.endsWith(']')) {
		return v
			.slice(1, -1)
			.split(',')
			.map(s => extractValue(s.trim()))
			.filter(Boolean);
	}
	if (v) return [extractValue(v)];
	return [];
}
