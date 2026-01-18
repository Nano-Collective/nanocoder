/**
 * Slug generator for creating unique plan identifiers.
 *
 * Plan IDs follow the format: {adjective}-{verb}-{noun}
 * Example: focused-creating-feature
 *
 * The word lists are curated to be:
 * - Short and memorable (3-4 syllables max)
 * - Relevant to software development
 * - Non-overlapping in meaning
 */

const ADJECTIVES = [
	'focused',
	'careful',
	'systematic',
	'strategic',
	'comprehensive',
	'detailed',
	'thorough',
	'analytical',
	'structured',
	'organized',
	'precise',
	'methodical',
	'deliberate',
	'calculated',
	'logical',
	'careful',
	'meticulous',
	'exact',
	'specific',
	'clarity-focused',
	'organized',
	'thoughtful',
	'intentional',
	'purposeful',
	'directed',
	'analytical',
	'exploratory',
	'inquisitive',
	'inquisitive',
	'curious',
	'investigative',
	'examinational',
	'research-driven',
	'discovery-focused',
] as const;

const VERBS = [
	'implementing',
	'building',
	'creating',
	'developing',
	'adding',
	'enhancing',
	'refactoring',
	'extending',
	'integrating',
	'modifying',
	'updating',
	'improving',
	'optimizing',
	'revamping',
	'overhauling',
	'redesigning',
	'restructuring',
	'reworking',
	'crafting',
	'constructing',
	'assembling',
	'engineering',
	'architecting',
	'formulating',
	'designing',
	'planning',
	'outlining',
	'sketching',
	'drafting',
	'prototyping',
	'modeling',
	'specifying',
	'defining',
	'establishing',
	'configuring',
	'customizing',
	'tailoring',
	'adapting',
	'extending',
	'expanding',
	'augmenting',
	'enriching',
	'fortifying',
	'strengthening',
	'reinforcing',
	'solidifying',
	'stabilizing',
	'securing',
	'protecting',
	'safeguarding',
] as const;

const NOUNS = [
	'feature',
	'system',
	'module',
	'component',
	'functionality',
	'capability',
	'interface',
	'workflow',
	'process',
	'architecture',
	'infrastructure',
	'function',
	'method',
	'class',
	'service',
	'handler',
	'utility',
	'helper',
	'library',
	'framework',
	'implementation',
	'solution',
	'mechanism',
	'pipeline',
	'strategy',
	'pattern',
	'abstraction',
	'layer',
	'module',
	'package',
	'extension',
	'plugin',
	'add-on',
	'integration',
	'connection',
	'bridge',
	'adapter',
	'wrapper',
	'facade',
	'manager',
	'controller',
	'handler',
	'response',
	'request',
	'protocol',
	'format',
	'structure',
	'schema',
	'definition',
	'specification',
] as const;

/**
 * Session cache for generated slugs to ensure uniqueness
 */
const generatedSlugs = new Set<string>();

/**
 * Generate a random slug in the format {adjective}-{verb}-{noun}
 *
 * @returns A unique slug identifier
 */
export function generateSlug(): string {
	const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
	const verb = VERBS[Math.floor(Math.random() * VERBS.length)];
	const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
	return `${adj}-${verb}-${noun}`;
}

/**
 * Generate a unique slug that hasn't been used in this session
 *
 * @param existingSlugs - Optional set of existing slugs to check against
 * @returns A guaranteed unique slug identifier
 */
export function generateUniqueSlug(existingSlugs?: Set<string>): string {
	const checkSet = existingSlugs || generatedSlugs;
	let attempts = 0;
	const maxAttempts = 10;

	while (attempts < maxAttempts) {
		const slug = generateSlug();
		if (!checkSet.has(slug)) {
			checkSet.add(slug);
			generatedSlugs.add(slug);
			return slug;
		}
		attempts++;
	}

	// Fallback: add a random number suffix
	const baseSlug = generateSlug();
	const fallbackSlug = `${baseSlug}-${Date.now().toString(36)}`;
	generatedSlugs.add(fallbackSlug);
	return fallbackSlug;
}

/**
 * Check if a slug has already been generated
 *
 * @param slug - The slug to check
 * @returns true if the slug has been generated
 */
export function isSlugGenerated(slug: string): boolean {
	return generatedSlugs.has(slug);
}

/**
 * Reset the slug cache (mainly for testing)
 */
export function clearSlugCache(): void {
	generatedSlugs.clear();
}

/**
 * Validate that a string is a valid slug format
 *
 * @param slug - The slug to validate
 * @returns true if the slug matches the expected format
 */
export function isValidSlug(slug: string): boolean {
	// Check format: three hyphenated lowercase words
	const slugPattern = /^[a-z]+-[a-z]+-[a-z]+(?:-[a-z0-9]+)?$/;
	return slugPattern.test(slug);
}

/**
 * Get all word lists for external use (e.g., testing)
 *
 * @returns The word lists used for slug generation
 */
export function getWordLists() {
	return {ADJECTIVES, VERBS, NOUNS};
}
