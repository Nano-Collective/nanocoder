/**
 * Brief Summary Generator for Plan Directories
 *
 * Generates meaningful kebab-case summaries for plan directories using a hybrid approach:
 * 1. LLM-based generation for semantic understanding (intent classification)
 * 2. Fallback to semantic extraction when LLM is unavailable
 *
 * Examples:
 * - "Analyze why Home/End keys don't work" → "analyze-home-end-keys-issue"
 * - "Add authentication to the API" → "add-api-authentication"
 * - "Fix memory leak in image processor" → "fix-image-processor-memory-leak"
 * - "Refactor state management to use hooks" → "refactor-state-management-hooks"
 */

import type {LLMClient} from '@/types/core';

/**
 * Common verbs in software development requests
 */
const ACTION_VERBS = new Set([
	'add',
	'update',
	'remove',
	'delete',
	'refactor',
	'fix',
	'implement',
	'create',
	'modify',
	'enhance',
	'optimize',
	'improve',
	'change',
	'replace',
	'integrate',
	'migrate',
	'configure',
	'setup',
	'build',
	'deploy',
	'analyze',
	'investigate',
	'examine',
	'explore',
	'research',
	'debug',
	'test',
	'verify',
	'validate',
	'document',
	'review',
	'audit',
	'check',
	'inspect',
]);

/**
 * Words to filter out (stop words)
 */
const STOP_WORDS = new Set([
	'i',
	'want',
	'to',
	'the',
	'a',
	'an',
	'for',
	'with',
	'and',
	'or',
	'but',
	'in',
	'on',
	'at',
	'by',
	'from',
	'of',
	'is',
	'are',
	'was',
	'were',
	'be',
	'been',
	'being',
	'have',
	'has',
	'had',
	'do',
	'does',
	'did',
	'will',
	'would',
	'should',
	'could',
	'may',
	'might',
	'must',
	'can',
	'need',
	'make',
	'get',
	'go',
	'help',
	'see',
	'try',
	'use',
]);

/**
 * Session cache for generated summaries to ensure uniqueness
 */
const generatedSummaries = new Set<string>();

/**
 * Generate a brief summary using LLM-based intent classification with semantic extraction fallback
 *
 * First attempts LLM-based semantic understanding for meaningful, intent-driven names.
 * Falls back to rule-based semantic extraction if LLM is unavailable or fails.
 *
 * @param userRequest - The user's plan request
 * @param llmClient - Optional LLM client for intent classification (any object with chat method)
 * @returns A kebab-case brief summary
 */
export async function generateBriefSummary(
	userRequest: string,
	llmClient?: LLMClient | null,
): Promise<string> {
	let summary: string;

	// Try LLM-based intent classification first if client is available
	if (llmClient) {
		try {
			summary = await generateLLMIntentSummary(userRequest, llmClient);
		} catch (_error) {
			// Fall back to semantic extraction if LLM fails
			summary = generateSemanticExtraction(userRequest);
		}
	} else {
		// Use semantic extraction as fallback
		summary = generateSemanticExtraction(userRequest);
	}

	const uniqueSummary = await ensureUniqueSummary(summary);
	generatedSummaries.add(uniqueSummary);
	return uniqueSummary;
}

/**
 * Generate summary using LLM intent classification
 *
 * Uses a focused prompt to extract the core intent and generate a meaningful kebab-case name.
 *
 * @param userRequest - The user's request
 * @param llmClient - LLM client to use (must match LLMClient.chat signature)
 * @returns Intent-based kebab-case summary
 */
async function generateLLMIntentSummary(
	userRequest: string,
	llmClient: LLMClient,
): Promise<string> {
	const prompt = `You are a plan naming assistant. Generate a meaningful kebab-case directory name (max 4 parts) that captures the core intent of the user's request.

User request: "${userRequest.substring(0, 500)}"

Guidelines:
1. Start with the main action verb (analyze, fix, add, refactor, etc.)
2. Add 2-3 key domain terms that capture what's being worked on
3. Use technical terminology when appropriate
4. Keep it UNDERSTANDABLE - avoid generic truncation
5. Focus on WHAT is being done, not peripheral details

Examples:
- "Analyze why copy-paste shows brackets" → "analyze-copy-paste-brackets-issue"
- "Fix Home and End key navigation" → "fix-home-end-key-navigation"
- "Add authentication to API endpoints" → "add-api-authentication"
- "Investigate memory leak in image processing" → "investigate-image-memory-leak"

Return ONLY the kebab-case name, no explanation.`;

	// Call LLM client with correct signature:
	// client.chat(messages, tools, callbacks, signal)
	const result = await llmClient.chat(
		[{role: 'user', content: prompt}], // messages
		{}, // tools (empty for summary generation)
		{
			// No special callbacks needed for simple text generation
			onFinish: () => {},
		}, // callbacks
		undefined, // signal (no timeout)
	);

	// Extract text from result
	let summary = result?.choices?.[0]?.message?.content || '';
	summary = summary.trim().toLowerCase();

	// Clean up: remove markdown code blocks, extra whitespace, etc.
	summary = summary.replace(/```[\w]*\n?/g, '').trim();
	summary = summary.replace(/['"]/g, '').trim();

	// Validate it's proper kebab-case
	if (!isValidSummary(summary)) {
		throw new Error(`LLM generated invalid summary: "${summary}"`);
	}

	return summary;
}

/**
 * Generate summary using improved semantic extraction
 *
 * This uses NLP-inspired techniques:
 * - Extract core intent from first sentence
 * - Identify action verbs
 * - Extract meaningful noun phrases (not just individual words)
 * - Filter out noise and generic words
 *
 * @param userRequest - The user's request
 * @returns Semantic-extracted summary
 */
function generateSemanticExtraction(userRequest: string): string {
	// Extract only the first sentence for the main intent
	// Split on sentence delimiters and take the first part
	const firstSentence = userRequest.split(/[.!?]/)[0];

	// Normalize and tokenize the first sentence
	const words = firstSentence
		.toLowerCase()
		.replace(/[^\w\s-]/g, '') // Remove punctuation
		.split(/\s+/)
		.filter(w => w.length > 0 && !STOP_WORDS.has(w));

	// Find action verb
	let verb = words.find(w => ACTION_VERBS.has(w));
	if (!verb) {
		// Try to find any verb that looks like an action
		verb = words.find(w => w.endsWith('e') || w.endsWith('ing')) || 'update';
	}

	// Extract 2-3 key nouns, focusing on meaningful technical terms
	// Filter out generic words and prioritize domain-specific terms
	const genericWords = new Set([
		'current',
		'currently',
		'when',
		'then',
		'now',
		'also',
		'just',
		'still',
		'only',
		'very',
		'really',
		'much',
		'many',
		'some',
		'this',
		'that',
		'these',
		'those',
		'there',
		'here',
		'which',
		'what',
		'where',
		'why',
		'how',
		'who',
		'whose',
		'whom',
		'into',
		'onto',
		'upon',
		'within',
		'without',
		'through',
	]);

	const nouns = words
		.filter(w => w !== verb && !STOP_WORDS.has(w) && !genericWords.has(w))
		.slice(0, 3);

	// Combine verb + nouns, max 4 parts total
	const parts = [verb, ...nouns].filter(Boolean);
	let summary = parts.join('-');

	// Limit to 4 parts max for shorter, more focused names
	const summaryParts = summary.split('-');
	if (summaryParts.length > 4) {
		summary = summaryParts.slice(0, 4).join('-');
	}

	return summary;
}

/**
 * Ensure summary is unique by adding numeric suffix if needed
 *
 * @param baseSummary - The base summary
 * @param existingSummaries - Optional set of existing summaries to check
 * @returns A unique summary
 */
export async function ensureUniqueSummary(
	baseSummary: string,
	existingSummaries?: Set<string>,
): Promise<string> {
	// Note: This will check against actual filesystem when called from PlanManager
	// For now, just ensure it doesn't conflict with session cache
	const checkSet = existingSummaries || generatedSummaries;

	if (!checkSet.has(baseSummary)) {
		return baseSummary;
	}

	// Add numeric suffix
	let counter = 2;
	let uniqueSummary = `${baseSummary}-${counter}`;
	while (checkSet.has(uniqueSummary) && counter < 100) {
		counter++;
		uniqueSummary = `${baseSummary}-${counter}`;
	}

	return uniqueSummary;
}

/**
 * Validate that a summary is valid kebab-case format
 *
 * @param summary - The summary to validate
 * @returns true if valid
 */
export function isValidSummary(summary: string): boolean {
	// Must be kebab-case: start with letter, lowercase letters/numbers/hyphens
	const summaryPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
	return summaryPattern.test(summary);
}

/**
 * Check if a summary has been generated this session
 *
 * @param summary - The summary to check
 * @returns true if already generated
 */
export function isSummaryGenerated(summary: string): boolean {
	return generatedSummaries.has(summary);
}

/**
 * Clear the summary cache (mainly for testing)
 */
export function clearSummaryCache(): void {
	generatedSummaries.clear();
}

/**
 * Get the action verb from a summary
 *
 * @param summary - The summary to analyze
 * @returns The action verb or null
 */
export function extractVerb(summary: string): string | null {
	const parts = summary.split('-');
	if (parts.length > 0) {
		return ACTION_VERBS.has(parts[0]) ? parts[0] : null;
	}
	return null;
}
