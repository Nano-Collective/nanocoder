/**
 * Llama tokenizer for local models
 * Uses llama-tokenizer-js package
 */

import llamaTokenizer from 'llama-tokenizer-js';
import type {Message} from '@/types/core';
import {estimateTokens} from '@/utils/token-calculator';
import type {Tokenizer} from '../../types/tokenization';

export class LlamaTokenizer implements Tokenizer {
	private modelName: string;

	constructor(modelId?: string) {
		this.modelName = modelId || 'llama';
	}

	encode(text: string): number {
		try {
			const tokens = llamaTokenizer.encode(text);
			return tokens.length;
		} catch {
			// Fallback to character-based estimation if tokenization fails
			return estimateTokens(text);
		}
	}

	countTokens(message: Message): number {
		const content = message.content || '';
		const role = message.role || '';

		// Llama format: <|start_header_id|>role<|end_header_id|>content<|eot_id|>
		// Approximate overhead for message formatting
		const messageOverhead = 6;

		return this.encode(content) + this.encode(role) + messageOverhead;
	}

	getName(): string {
		return `llama-${this.modelName}`;
	}
}
