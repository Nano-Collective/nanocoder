export type ModelTier = 'simple' | 'strong';

export type SensitivityThreshold = 'low' | 'medium' | 'high';

export interface SmartRouteOptions {
	threshold?: SensitivityThreshold;
	/** Additional custom keywords to treat as complex/strong */
	customComplexKeywords?: string[];
	/** Additional custom keywords to treat as trivial/simple */
	customTrivialKeywords?: string[];
	/** Additional regex patterns for lightweight model detection */
	customLightweightPatterns?: RegExp[];
}

export const DEFAULT_COMPLEX_KEYWORDS: readonly string[] = [
	'refactor',
	'architect',
	'redesign',
	'implement',
	'rewrite',
	'debug',
	'security',
	'performance',
	'optimize',
	'migration',
];

export const DEFAULT_TRIVIAL_KEYWORDS: readonly string[] = [
	'hi',
	'hey',
	'thanks',
	'thank you',
	'ok',
	'okay',
	'yes',
	'no',
	'view',
	'show',
	'list',
	'cat',
	'read',
	'check',
	'find',
	'where',
	'what is',
	'typo',
	'format',
	'status',
	'help',
];

export const DEFAULT_LIGHTWEIGHT_MODEL_PATTERNS: readonly RegExp[] = [
	/mini/i,
	/haiku/i,
	/flash/i,
	/instant/i,
	/lite/i,
	/small/i,
	/nano/i,
	/8b/i,
	/7b/i,
	/3b/i,
	/1b/i,
];

/**
 * Count occurrences of fenced code blocks (``` ... ```) in the text.
 */
function countCodeBlocks(text: string): number {
	const matches = text.match(/```/g);
	// Each code block has an opening and closing fence
	return matches ? Math.floor(matches.length / 2) : 0;
}

/**
 * Helper to test word boundary matching (avoids false positives inside subwords).
 * e.g. "cat" won't match inside "categories".
 */
function containsWord(text: string, word: string): boolean {
	const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`\\b${escaped}\\b`, 'i');
	return regex.test(text);
}

/**
 * Classifies turn complexity based on prompt heuristics and configurable options.
 *
 * Evaluation order:
 *  1. Multiple code blocks (≥2) → always strong
 *  2. Complex keyword match → strong
 *  3. Prompt length exceeds threshold → strong
 *  4. Single code block present → strong
 *  5. Trivial keyword match → simple
 *  6. No signal either way → default to strong (fail-safe)
 */
export function classifyTurnComplexity(
	promptText: string,
	options: SmartRouteOptions = {},
): ModelTier {
	const text = promptText.trim();
	const threshold = options.threshold ?? 'medium';

	// Empty or whitespace-only input — nothing to reason about
	if (text.length === 0) {
		return 'simple';
	}

	const maxSimpleLength =
		threshold === 'high' ? 300 : threshold === 'low' ? 100 : 200;

	const codeBlockCount = countCodeBlocks(text);

	// Rule 1: Multiple code blocks signal heavy edits / multi-file work
	if (codeBlockCount >= 2) {
		return 'strong';
	}

	// Merge default and custom keywords
	const complexKeywords = [
		...DEFAULT_COMPLEX_KEYWORDS,
		...(options.customComplexKeywords ?? []),
	];

	const trivialKeywords = [
		...DEFAULT_TRIVIAL_KEYWORDS,
		...(options.customTrivialKeywords ?? []),
	];

	// Rule 2: Complex keyword detected
	const hasComplexKeyword = complexKeywords.some(kw => containsWord(text, kw));
	if (hasComplexKeyword) {
		return 'strong';
	}

	// Rule 3: Prompt length exceeds threshold
	if (text.length > maxSimpleLength) {
		return 'strong';
	}

	// Rule 4: A single code block still warrants the strong model
	if (codeBlockCount === 1) {
		return 'strong';
	}

	// Rule 5: Trivial keyword detected → safe to use simple model
	const hasTrivialKeyword = trivialKeywords.some(kw => containsWord(text, kw));
	if (hasTrivialKeyword) {
		return 'simple';
	}

	// Rule 6: No signal either way — default to strong to avoid
	// sending ambiguous requests to an underpowered model.
	return 'strong';
}

/**
 * Automatically selects a suitable simple/fast model from a provider's list of available models.
 * Allows custom regex patterns to extend the default lightweight model detection.
 */
export function autoSelectSimpleModel(
	availableModels: string[],
	options: SmartRouteOptions = {},
): string | undefined {
	if (!availableModels || availableModels.length === 0) {
		return undefined;
	}

	const patterns = [
		...DEFAULT_LIGHTWEIGHT_MODEL_PATTERNS,
		...(options.customLightweightPatterns ?? []),
	];

	for (const pattern of patterns) {
		const match = availableModels.find(m => pattern.test(m));
		if (match) {
			return match;
		}
	}

	return availableModels[0];
}
