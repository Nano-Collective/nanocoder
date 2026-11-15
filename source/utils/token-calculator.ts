import {CHARS_PER_TOKEN_ESTIMATE} from '@/constants';

/**
 * Rough token count for `text`: one token per CHARS_PER_TOKEN_ESTIMATE
 * characters, rounded up. For UI display, budgets and fallbacks where a
 * real tokenizer is unavailable, failed, or too slow.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}
