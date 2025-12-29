/**
 * Token estimation for messages using pluggable tokenizers
 * Provides provider-agnostic token counting with fallback heuristic
 */

import {createTokenizer} from '@/tokenization/tokenizer-factory';
import type {Message} from '@/types/core';
import type {Tokenizer} from '@/types/tokenization';

/**
 * Get tokenizer for a model
 * Falls back to conservative heuristic if exact tokenizer unavailable
 */
export function getTokenizer(providerName?: string, model?: string): Tokenizer {
	// If both are provided, use them; otherwise try to infer from model
	if (model) {
		const provider = providerName || '';
		return createTokenizer(provider, model);
	}

	// Fallback to generic tokenizer
	return createTokenizer('', 'unknown');
}

/**
 * Estimate tokens for a single message
 */
export function estimateMessageTokens(
	message: Message,
	tokenizer: Tokenizer,
): number {
	let total = 0;

	// Role overhead (~4 tokens per message for structure)
	total += 4;

	// Content
	if (typeof message.content === 'string') {
		total += tokenizer.encode(message.content);
	}

	// Tool calls (when assistant calls a tool)
	if (message.tool_calls) {
		for (const call of message.tool_calls) {
			total += tokenizer.encode(call.function.name);
			total += tokenizer.encode(JSON.stringify(call.function.arguments));
			total += 10; // Structure overhead
		}
	}

	// Tool call ID (for tool response messages)
	if (message.tool_call_id) {
		total += tokenizer.encode(message.tool_call_id);
		total += 2;
	}

	// Tool name
	if (message.name) {
		total += tokenizer.encode(message.name);
		total += 2;
	}

	return total;
}

/**
 * Estimate tokens for entire message array
 */
export function estimateTokens(
	messages: Message[],
	providerName?: string,
	model?: string,
): number {
	const tokenizer = getTokenizer(providerName, model);
	let total = 0;

	for (const message of messages) {
		total += estimateMessageTokens(message, tokenizer);
	}

	// Add overhead for message list structure
	total += 3;

	return total;
}
