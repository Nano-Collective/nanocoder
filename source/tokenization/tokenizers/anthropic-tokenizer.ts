/**
 * Anthropic tokenizer for Claude models
 * Uses @anthropic-ai/tokenizer package
 */

import {createRequire} from 'node:module';
import type {Message} from '@/types/core';
import type {Tokenizer} from '../../types/tokenization';

type AnthropicModule = typeof import('@anthropic-ai/tokenizer');

const require = createRequire(import.meta.url);
let anthropicModule: AnthropicModule | undefined;

/**
 * Anthropic tokenizer for Claude models
 */
export class AnthropicTokenizer implements Tokenizer {
	private modelName: string;

	constructor(modelId?: string) {
		this.modelName = modelId || 'claude-3';
	}

	encode(text: string): number {
		try {
			// Loaded on first use so non-Claude sessions never pay for the package
			anthropicModule ??= require('@anthropic-ai/tokenizer') as AnthropicModule;
			return anthropicModule.countTokens(text);
		} catch {
			// Fallback to character-based estimation if tokenization fails
			return Math.ceil(text.length / 4);
		}
	}

	countTokens(message: Message): number {
		const content = message.content || '';
		const role = message.role || '';

		// Anthropic format includes role in the message structure
		// Approximate overhead for message formatting
		const messageOverhead = 3;

		return this.encode(content) + this.encode(role) + messageOverhead;
	}

	getName(): string {
		return `anthropic-${this.modelName}`;
	}
}
