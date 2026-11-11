/**
 * OpenAI tokenizer using tiktoken
 * Supports GPT-3.5, GPT-4, and other OpenAI models
 */

import {encoding_for_model, get_encoding, type TiktokenModel} from 'tiktoken';
import type {Message} from '@/types/core';
import {estimateTokens} from '@/utils/token-calculator';
import type {Tokenizer} from '../../types/tokenization';

/**
 * OpenAI tokenizer using tiktoken for accurate token counting
 */
export class OpenAITokenizer implements Tokenizer {
	private encoding: ReturnType<typeof get_encoding>;
	private modelName: string;

	constructor(modelId?: string) {
		this.modelName = modelId || 'gpt-4';

		try {
			this.encoding = encoding_for_model(modelId as TiktokenModel);
		} catch {
			this.encoding = get_encoding('cl100k_base');
		}
	}

	encode(text: string): number {
		try {
			const tokens = this.encoding.encode(text);
			return tokens.length;
		} catch {
			return estimateTokens(text);
		}
	}

	countTokens(message: Message): number {
		const content = message.content || '';
		const role = message.role || '';

		// OpenAI format: each message has overhead for role markers
		// <|im_start|>role\ncontent<|im_end|>
		const messageOverhead = 4; // Approximate overhead per message

		return this.encode(content) + this.encode(role) + messageOverhead;
	}

	getName(): string {
		return `openai-${this.modelName}`;
	}

	/**
	 * Clean up encoding resources
	 */
	free(): void {
		this.encoding.free();
	}
}
