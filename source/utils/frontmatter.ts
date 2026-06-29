import {parse as parseYaml} from 'yaml';

/**
 * Result of splitting a markdown file into YAML frontmatter and body.
 */
export interface FrontmatterSplit {
	/** Raw YAML frontmatter contents (without the --- delimiters). */
	frontmatter: string;
	/** Body content (trimmed). */
	body: string;
	/** True if the file had a recognised --- ... --- block. */
	hasFrontmatter: boolean;
}

/**
 * Split a markdown file into its frontmatter block and body.
 *
 * Recognises the standard `---\n...\n---\n` pattern at the start of the file.
 * When no frontmatter is found, the whole file is returned as `body` and
 * `hasFrontmatter` is false.
 */
export function splitFrontmatter(fileContent: string): FrontmatterSplit {
	// The frontmatter group is optional (`(?:…)?`) so an empty block —
	// `---\n---\n` with no lines between the delimiters — is still recognised
	// rather than leaking the literal `---` markers into the body.
	const frontmatterRegex =
		/^---\s*\r?\n(?:([\s\S]*?)\r?\n)?---\s*\r?\n?([\s\S]*)$/;
	const match = fileContent.match(frontmatterRegex);
	if (match && match[2] !== undefined) {
		return {
			frontmatter: match[1] ?? '',
			body: match[2].trim(),
			hasFrontmatter: true,
		};
	}
	return {
		frontmatter: '',
		body: fileContent.trim(),
		hasFrontmatter: false,
	};
}

/**
 * Parse a YAML frontmatter string into a plain object using the `yaml`
 * library. Supports nested objects, arrays, multi-line strings, etc.
 *
 * Returns `null` on parse failure or when the YAML doesn't resolve to an
 * object (e.g. a scalar). Callers should treat `null` as "invalid metadata".
 */
export function parseYamlObject(
	frontmatter: string,
): Record<string, unknown> | null {
	if (!frontmatter.trim()) return {};
	let parsed: unknown;
	try {
		parsed = parseYaml(frontmatter);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return null;
	}
	return parsed as Record<string, unknown>;
}
