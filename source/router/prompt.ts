/**
 * Router prompt builder.
 *
 * Builds a concise classification prompt that asks the router model to
 * return exactly one category name. Adapted from LocalClaw's buildRouterPrompt().
 */

import type {RouterConfig, SpecialistCategory} from './types';
import {SPECIALIST_CATEGORIES} from './types';

/**
 * Build the router classification prompt.
 *
 * The prompt is intentionally short to minimise latency and token usage.
 * The model is asked to return ONLY the category name — no explanation.
 */
export function buildRouterPrompt(
	message: string,
	config: RouterConfig,
): string {
	const categoryLines = SPECIALIST_CATEGORIES.map(cat => {
		const desc =
			config.categories[cat] ??
			(cat === 'chat'
				? 'Simple conversation, greetings, questions answerable from context'
				: cat);
		return `${cat}: ${desc}`;
	}).join('\n');

	return `Classify this message into exactly one category. Return ONLY the category name, nothing else.

Categories:
${categoryLines}

Message: "${message}"

Category:`;
}

/**
 * Clean and validate a model response as a category name.
 * Strips non-alpha-underscore characters and checks against valid categories.
 */
export function cleanCategoryResponse(raw: string): SpecialistCategory | null {
	const cleaned = raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z_]/g, '');

	if ((SPECIALIST_CATEGORIES as readonly string[]).includes(cleaned)) {
		return cleaned as SpecialistCategory;
	}

	return null;
}
