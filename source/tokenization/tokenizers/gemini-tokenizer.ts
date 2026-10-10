import type {Message} from '@/types/core';
import type {Tokenizer} from '../../types/tokenization';

/**
 * Gemini tokenizer for Google Gemini models.
 *
 * There is no official Gemini tokenizer on npm (tokenization is
 * SentencePiece-based and only available via the server-side countTokens
 * API), so this uses a calibrated chars-per-token heuristic. Google
 * documents ~4000 characters ≈ 1000 tokens for Gemini, i.e. ~4 chars
 * per token for English text. This is significantly more accurate for
 * Gemini than the generic o200k_base BPE proxy.
 */
export class GeminiTokenizer implements Tokenizer {
	private readonly CHARS_PER_TOKEN = 4;
	private modelName: string;

	constructor(modelId?: string) {
		this.modelName = modelId || 'gemini';
	}

	encode(text: string): number {
		if (!text) {
			return 0;
		}
		return Math.ceil(text.length / this.CHARS_PER_TOKEN);
	}

	countTokens(message: Message): number {
		const content = message.content || '';
		const role = message.role || '';

		// Gemini chat format overhead for role markers and message structure
		const messageOverhead = 4;

		return this.encode(content) + this.encode(role) + messageOverhead;
	}

	getName(): string {
		return `gemini-${this.modelName}`;
	}
}
