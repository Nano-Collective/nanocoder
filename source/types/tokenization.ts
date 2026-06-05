/**
 * Tokenizer interface and types
 */

import type {Message} from '@/types/core';

/**
 * Tokenizer interface for encoding text and counting tokens
 */
export interface Tokenizer {
	/**
	 * Encode text and return token count
	 */
	encode(text: string): number;

	/**
	 * Count tokens in a message (content + role)
	 */
	countTokens(message: Message): number;

	/**
	 * Get the tokenizer name/type
	 */
	getName(): string;

	/**
	 * Optional cleanup method for releasing resources
	 * Should be called when the tokenizer is no longer needed
	 */
	free?(): void;
}

/**
 * Provider types for tokenizer selection
 */
export type TokenizerProvider = 'openai' | 'anthropic' | 'llama' | 'fallback';
