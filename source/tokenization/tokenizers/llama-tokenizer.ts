/**
 * Llama tokenizer for local models
 * Uses llama-tokenizer-js package
 */

import {createRequire} from 'node:module';
import type {Message} from '@/types/core';
import type {Tokenizer} from '../../types/tokenization';

type LlamaModule = typeof import('llama-tokenizer-js');
type LlamaTokenizerInstance = LlamaModule['default'];

const require = createRequire(import.meta.url);
let llamaTokenizer: LlamaTokenizerInstance | undefined;

/** Load llama-tokenizer-js on first use so non-Llama sessions never pay for it */
function loadLlama(): LlamaTokenizerInstance {
	if (!llamaTokenizer) {
		const mod = require('llama-tokenizer-js');
		llamaTokenizer = (mod.default ?? mod) as LlamaTokenizerInstance;
	}
	return llamaTokenizer;
}

export class LlamaTokenizer implements Tokenizer {
	private modelName: string;

	constructor(modelId?: string) {
		this.modelName = modelId || 'llama';
	}

	encode(text: string): number {
		try {
			const tokens = loadLlama().encode(text);
			return tokens.length;
		} catch {
			// Fallback to character-based estimation if tokenization fails
			return Math.ceil(text.length / 4);
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
