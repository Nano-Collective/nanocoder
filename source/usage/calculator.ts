/**
 * Usage calculator
 * Calculates token breakdown by category
 */

import {
	TOKENS_PER_TOOL_ESTIMATE,
	TOKENS_PER_TOOL_FRAMING,
	USAGE_ERROR_THRESHOLD_PERCENT,
	USAGE_SUCCESS_THRESHOLD_PERCENT,
} from '@/constants';
import type {AISDKCoreTool, Message} from '@/types/core';
import {asSchema} from '@/types/core';
import type {Tokenizer} from '@/types/tokenization';
import type {TokenBreakdown} from '../types/usage';

/**
 * Calculate token breakdown from messages
 * @param messages - Messages to calculate breakdown for
 * @param tokenizer - Tokenizer instance (used as fallback if getTokens not provided)
 * @param getTokens - Optional cached token counting function for performance
 */
export function calculateTokenBreakdown(
	messages: Message[],
	tokenizer: Tokenizer,
	getTokens?: (message: Message) => number,
): TokenBreakdown {
	const breakdown: TokenBreakdown = {
		system: 0,
		userMessages: 0,
		assistantMessages: 0,
		toolDefinitions: 0,
		toolResults: 0,
		total: 0,
	};

	for (const message of messages) {
		const tokens = getTokens
			? getTokens(message)
			: tokenizer.countTokens(message);

		switch (message.role) {
			case 'system':
				breakdown.system += tokens;
				break;

			case 'user':
				breakdown.userMessages += tokens;
				break;

			case 'assistant':
				breakdown.assistantMessages += tokens;
				break;

			case 'tool':
				breakdown.toolResults += tokens;
				break;

			default:
				// Unknown roles go to assistant messages
				breakdown.assistantMessages += tokens;
		}
	}

	// Calculate total
	breakdown.total =
		breakdown.system +
		breakdown.userMessages +
		breakdown.assistantMessages +
		breakdown.toolDefinitions +
		breakdown.toolResults;

	return breakdown;
}

/**
 * Estimate tokens for the native tool definitions actually sent to the model.
 *
 * A flat per-tool constant is wildly inaccurate because real schemas vary by an
 * order of magnitude — a tiny tool with one string param versus an MCP tool with
 * a deeply nested schema and long field descriptions. Here we serialize each
 * tool's name, description and JSON input schema and tokenize that, which tracks
 * the real prompt far more closely and shrinks the gap between the streaming
 * estimate and the provider-reported count.
 *
 * Any tool whose JSON schema can't be resolved synchronously (a promise-backed
 * `FlexibleSchema`) falls back to the flat per-tool constant so the figure is
 * never worse than the old behaviour for that tool.
 */
export function calculateToolDefinitionsTokensFromDefs(
	tools: Record<string, AISDKCoreTool>,
	tokenizer: Tokenizer,
): number {
	let total = 0;

	for (const [name, toolDef] of Object.entries(tools)) {
		let serialized = name;
		if (typeof toolDef.description === 'string') {
			serialized += `\n${toolDef.description}`;
		}

		let schemaResolved = false;
		if (toolDef.inputSchema) {
			try {
				const schema = asSchema(toolDef.inputSchema).jsonSchema;
				// `jsonSchema` is `JSONSchema7 | PromiseLike<JSONSchema7>`; only the
				// synchronous object can be serialized here.
				const isThenable =
					typeof (schema as {then?: unknown})?.then === 'function';
				if (schema && !isThenable) {
					serialized += `\n${JSON.stringify(schema)}`;
					schemaResolved = true;
				}
			} catch {
				// Unresolvable schema — fall back to the flat constant below.
			}
		}

		total += tokenizer.encode(serialized) + TOKENS_PER_TOOL_FRAMING;
		if (!schemaResolved) {
			total += TOKENS_PER_TOOL_ESTIMATE;
		}
	}

	return total;
}

/**
 * Get status color based on percentage used
 */
export function getUsageStatusColor(
	percentUsed: number,
): 'success' | 'warning' | 'error' {
	if (percentUsed < USAGE_SUCCESS_THRESHOLD_PERCENT) {
		return 'success';
	} else if (percentUsed < USAGE_ERROR_THRESHOLD_PERCENT) {
		return 'warning';
	} else {
		return 'error';
	}
}

/**
 * Format token count with thousands separator
 */
export function formatTokenCount(tokens: number): string {
	return tokens.toLocaleString();
}
