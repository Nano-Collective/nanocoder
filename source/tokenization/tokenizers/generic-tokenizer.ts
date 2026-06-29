/**
 * Generic tokenizer for models without a provider-specific encoder.
 *
 * Uses tiktoken's `o200k_base` BPE, which tracks arbitrary modern models — and
 * especially code/JSON density — far more closely than a flat chars-per-token
 * ratio. Degrades to the char/4 FallbackTokenizer when tiktoken can't load
 * (constrained runtimes, WASM unavailable) or an encode throws, so this
 * tokenizer can never itself fail and stays a safe default for any provider.
 */

import {get_encoding} from 'tiktoken';
import type {Message} from '@/types/core';
import type {Tokenizer} from '../../types/tokenization';
import {FallbackTokenizer} from './fallback-tokenizer';

export class GenericTokenizer implements Tokenizer {
	private encoding: ReturnType<typeof get_encoding> | null = null;
	private readonly fallback = new FallbackTokenizer();

	constructor() {
		try {
			this.encoding = get_encoding('o200k_base');
		} catch {
			// WASM/native load failed — char/4 fallback below keeps us functional.
			this.encoding = null;
		}
	}

	encode(text: string): number {
		if (this.encoding) {
			try {
				return this.encoding.encode(text).length;
			} catch {
				// Encoding failed for this input — degrade to the heuristic.
			}
		}
		return this.fallback.encode(text);
	}

	countTokens(message: Message): number {
		const content = message.content || '';
		const role = message.role || '';
		// Content + role, matching the other real-encoder tokenizers. A precise
		// per-message chat-format overhead is provider-specific and unknown here,
		// so we don't guess one.
		return this.encode(content) + this.encode(role);
	}

	getName(): string {
		return this.encoding ? 'generic-o200k' : 'fallback';
	}

	free(): void {
		this.encoding?.free();
		this.encoding = null;
	}
}
