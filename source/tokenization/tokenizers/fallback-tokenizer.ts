import type {Message} from '@/types/core';
import {estimateTokens} from '@/utils/token-calculator';
import type {Tokenizer} from '../../types/tokenization';

/**
 * Fallback tokenizer for unsupported models
 * Uses a simple character-based estimation (see estimateTokens)
 */
export class FallbackTokenizer implements Tokenizer {
	encode(text: string): number {
		return estimateTokens(text);
	}

	countTokens(message: Message): number {
		const content = message.content || '';
		const role = message.role || '';

		// Count tokens for content + a small overhead for role and formatting
		return this.encode(content) + estimateTokens(role);
	}

	getName(): string {
		return 'fallback';
	}
}
