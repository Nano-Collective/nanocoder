import {readFileSync} from 'fs';
import {
	parseSubscribeBlock,
	SubscribeParseError,
} from '@/skills/parse-subscribe';
import type {CustomCommandMetadata, ParsedCustomCommand} from '@/types/index';
import type {SkillTrigger} from '@/types/skills';
import {parseYamlObject, splitFrontmatter} from '@/utils/frontmatter';
import {logError} from '@/utils/message-queue';

/**
 * Set of frontmatter keys that are always parsed as arrays
 */
const ARRAY_KEYS = new Set([
	'aliases',
	'parameters',
	'tags',
	'triggers',
	'examples',
	'references',
	'dependencies',
]);

/**
 * Set of frontmatter keys that are parsed as numbers
 */
const NUMBER_KEYS = new Set(['estimated-tokens']);

/**
 * Parse a value that may be a JSON-style array or a single item.
 * Returns an array of strings.
 */
function parseArrayValue(value: string): string[] {
	const trimmed = value.trim();
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		const content = trimmed.slice(1, -1);
		return content
			.split(',')
			.map(s => s.trim().replace(/^["']|["']$/g, ''))
			.filter(s => s.length > 0);
	}
	const cleaned = trimmed.replace(/^["']|["']$/g, '');
	return cleaned ? [cleaned] : [];
}

/**
 * Enhanced YAML frontmatter parser with support for multi-line strings,
 * arrays, and all command/skill metadata fields.
 */
function parseEnhancedFrontmatter(frontmatter: string): CustomCommandMetadata {
	const raw: Record<string, unknown> = {};
	const lines = frontmatter.split('\n');
	let currentKey: string | null = null;
	let currentValue: string[] = [];
	let isMultiline = false;
	let indentLevel = 0;

	const storeValue = (key: string, value: string) => {
		const trimmedValue = value.trim();

		if (ARRAY_KEYS.has(key)) {
			raw[key] = parseArrayValue(trimmedValue);
		} else if (NUMBER_KEYS.has(key)) {
			const num = Number(trimmedValue);
			if (!Number.isNaN(num)) {
				raw[key] = num;
			}
		} else {
			raw[key] = trimmedValue.replace(/^["']|["']$/g, '');
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue; // Skip if line is undefined
		const trimmedLine = line.trim();

		// Skip empty lines and comments
		if (!trimmedLine || trimmedLine.startsWith('#')) {
			continue;
		}

		// Check for YAML dash syntax (array items)
		if (
			trimmedLine.startsWith('- ') &&
			currentKey &&
			ARRAY_KEYS.has(currentKey)
		) {
			const arrayItem = trimmedLine
				.slice(2)
				.trim()
				.replace(/^["']|["']$/g, '');
			const arr = (raw[currentKey] as string[]) ?? [];
			arr.push(arrayItem);
			raw[currentKey] = arr;
			continue;
		}

		// Check for multi-line string indicators
		if (trimmedLine.endsWith('|') || trimmedLine.endsWith('>')) {
			const colonIndex = line.indexOf(':');
			if (colonIndex !== -1) {
				currentKey = line.slice(0, colonIndex).trim();
				isMultiline = true;
				currentValue = [];
				indentLevel = 0;
				continue;
			}
		}

		// Handle multi-line content
		if (isMultiline && currentKey) {
			const lineIndent = line.length - line.trimStart().length;

			if (trimmedLine && indentLevel === 0) {
				indentLevel = lineIndent;
			}

			if (trimmedLine && lineIndent >= indentLevel) {
				currentValue.push(line.slice(indentLevel));
			} else if (trimmedLine && lineIndent < indentLevel) {
				// End of multi-line block
				const multilineContent = currentValue.join('\n').trim();
				storeValue(currentKey, multilineContent);
				isMultiline = false;
				currentKey = null;
				currentValue = [];
				indentLevel = 0;
				// Re-process this line as a regular key-value pair
				i--; // Reprocess current line
				continue;
			} else if (!trimmedLine) {
				currentValue.push('');
			}

			// If this is the last line, process the accumulated multi-line value
			if (i === lines.length - 1 && currentValue.length > 0) {
				const multilineContent = currentValue.join('\n').trim();
				storeValue(currentKey, multilineContent);
			}

			continue;
		}

		// Handle regular key-value pairs — find colon outside quotes
		const colonIndex = findColonOutsideQuotes(line);
		if (colonIndex === -1) continue;

		const key = line.slice(0, colonIndex).trim();
		const value = line.slice(colonIndex + 1).trim();

		if (value) {
			storeValue(key, value);
			currentKey = key; // For potential array items following
		} else {
			currentKey = key; // Key with no immediate value, might have array items below
		}
	}

	return mapRawToMetadata(raw);
}

/**
 * Find the first colon that is not inside single or double quotes.
 */
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

/**
 * Map raw parsed key-value pairs to typed CustomCommandMetadata.
 */
function mapRawToMetadata(raw: Record<string, unknown>): CustomCommandMetadata {
	const metadata: CustomCommandMetadata = {};

	if (raw.description) metadata.description = raw.description as string;
	if (raw.aliases) metadata.aliases = raw.aliases as string[];
	if (raw.parameters) metadata.parameters = raw.parameters as string[];
	if (raw.tags) metadata.tags = raw.tags as string[];
	if (raw.triggers) metadata.triggers = raw.triggers as string[];
	if (typeof raw['estimated-tokens'] === 'number')
		metadata.estimatedTokens = raw['estimated-tokens'];
	if (raw.category) metadata.category = raw.category as string;
	if (raw.version) metadata.version = raw.version as string;
	if (raw.author) metadata.author = raw.author as string;
	if (raw.examples) metadata.examples = raw.examples as string[];
	if (raw.references) metadata.references = raw.references as string[];
	if (raw.dependencies) metadata.dependencies = raw.dependencies as string[];

	return metadata;
}

/**
 * Parse a markdown file with optional YAML frontmatter
 */
export function parseCommandFile(filePath: string): ParsedCustomCommand {
	const fileContent = readFileSync(filePath, 'utf-8');
	const split = splitFrontmatter(fileContent);

	// Preserve historical behavior: files with frontmatter but no body fall
	// through to "entire file is content" so the metadata block isn't silently
	// hidden from the user.
	if (split.hasFrontmatter && split.frontmatter && split.body) {
		let metadata: CustomCommandMetadata = {};

		try {
			metadata = parseEnhancedFrontmatter(split.frontmatter);
		} catch (error) {
			// If parsing fails, treat entire file as content
			logError(`Failed to parse frontmatter in ${filePath}: ${String(error)}`);
			return {
				metadata: {},
				content: fileContent,
			};
		}

		const subscribe = extractSubscribe(split.frontmatter, filePath);

		return {
			metadata,
			content: split.body,
			subscribe,
		};
	}

	// No frontmatter (or frontmatter with no body) — entire file is content.
	return {
		metadata: {},
		content: fileContent.trim(),
	};
}

/**
 * The hand-rolled frontmatter parser above does not handle list-of-objects,
 * which `subscribe:` requires. Do a second pass with the real YAML parser
 * just to lift the `subscribe:` block out cleanly. On any error, log and
 * skip — `subscribe:` is optional and a malformed block should not block
 * the command from loading.
 */
function extractSubscribe(
	frontmatter: string,
	filePath: string,
): SkillTrigger[] | undefined {
	const raw = parseYamlObject(frontmatter);
	if (!raw || raw.subscribe === undefined) return undefined;
	try {
		return parseSubscribeBlock(raw.subscribe);
	} catch (err) {
		if (err instanceof SubscribeParseError) {
			logError(`Invalid subscribe block in ${filePath}: ${err.message}`);
			return undefined;
		}
		throw err;
	}
}

/**
 * Parse a single `parameters:` entry. An entry is a positional name, with an
 * optional inline default after `=`:
 *
 *   "pr_number"            -> {name: 'pr_number', defaultValue: ''}
 *   "base=origin/main"     -> {name: 'base', defaultValue: 'origin/main'}
 *
 * The default is everything after the first `=`, so values may themselves
 * contain `=`. A defaulted parameter is the optional form: omit the argument
 * and the default is substituted instead of an empty string.
 */
export function parseCommandParameterSpec(spec: string): {
	name: string;
	defaultValue: string;
} {
	const eq = spec.indexOf('=');
	if (eq === -1) return {name: spec.trim(), defaultValue: ''};
	return {name: spec.slice(0, eq).trim(), defaultValue: spec.slice(eq + 1)};
}

/**
 * Replace template variables in command content
 */
export function substituteTemplateVariables(
	content: string,
	variables: Record<string, string>,
): string {
	let result = content;

	// Replace {{variable}} patterns
	for (const [key, value] of Object.entries(variables)) {
		const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
		result = result.replace(pattern, value);
	}

	return result;
}
