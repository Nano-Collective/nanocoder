/**
 * /usage command
 * Displays token usage statistics
 */

import React from 'react';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {UsageDisplay} from '@/components/usage/usage-display';
import {getAppConfig} from '@/config/index';
import {getToolManager} from '@/message-handler';
import {getModelContextLimit, getSessionContextLimit} from '@/models/index';
import {generateKey} from '@/session/key-generator';
import {createTokenizer} from '@/tokenization/index';
import type {Command} from '@/types/commands';
import type {TuneConfig} from '@/types/config';
import {getTuneToolMode} from '@/types/config';
import type {DevelopmentMode, Message} from '@/types/core';
import {
	calculateTokenBreakdown,
	calculateToolDefinitionsTokens,
} from '@/usage/calculator';
import {buildSystemPrompt, getLastBuiltPrompt} from '@/utils/prompt-builder';

export const usageCommand: Command = {
	name: 'usage',
	description: 'Display token usage statistics',
	handler: async (
		_args: string[],
		messages: Message[],
		metadata: {
			provider: string;
			model: string;
			tokens: number;
			getMessageTokens: (message: Message) => number;
			client?: import('@/types/core').LLMClient | null;
			tune?: TuneConfig;
			developmentMode?: DevelopmentMode;
		},
	) => {
		const {provider, model, getMessageTokens, client} = metadata;
		const tune = metadata.tune;
		const developmentMode: DevelopmentMode =
			metadata.developmentMode ?? 'normal';

		let tokenizer;
		let tokenizerName = 'fallback';

		try {
			// Create tokenizer for accurate breakdown
			tokenizer = createTokenizer(provider, model);
			tokenizerName = tokenizer.getName();
		} catch {
			// Fallback to a simple tokenizer if creation fails
			tokenizer = {
				encode: (text: string) => Math.ceil((text || '').length / 4),
				countTokens: (message: Message) =>
					Math.ceil(
						((message.content || '') + (message.role || '')).length / 4,
					),
				getName: () => 'fallback',
			};
			tokenizerName = 'fallback (error)';
		}

		// Build the system prompt + tool list fresh from the live tune/mode/model
		// so the breakdown reflects the active /tune profile (the cached prompt
		// can lag a just-applied profile change). When native tool calling is
		// off, tool definitions live inside the prompt, so we mirror that
		// injection exactly as the chat handler does.
		const toolManager = getToolManager();

		const config = getAppConfig();
		const providerConfig = config.providers?.find(p => p.name === provider);
		const nativeToolsDisabled =
			providerConfig?.disableTools === true ||
			(providerConfig?.disableToolModels?.includes(model) ?? false) ||
			getTuneToolMode(tune) !== 'native';

		const availableNames =
			toolManager?.getAvailableToolNames(
				tune,
				developmentMode,
				undefined,
				model,
			) ?? [];

		let systemPrompt: string;
		if (toolManager) {
			systemPrompt = buildSystemPrompt(
				developmentMode,
				tune,
				availableNames,
				nativeToolsDisabled,
				config.systemPrompt,
				model,
			);
			if (nativeToolsDisabled) {
				const fallbackToolFormat: 'xml' | 'json' =
					getTuneToolMode(tune) === 'json' ? 'json' : 'xml';
				systemPrompt = appendToolDefinitionsToPrompt(
					systemPrompt,
					true,
					fallbackToolFormat,
					toolManager.getFilteredTools(availableNames),
				);
			}
		} else {
			systemPrompt = getLastBuiltPrompt();
		}

		// Create system message to include in token calculation
		const systemMessage: Message = {
			role: 'system',
			content: systemPrompt,
		};

		// Calculate token breakdown from messages including system prompt
		// Note: We don't use getMessageTokens for the system message since it's freshly generated
		// and won't be in the cache. Instead, we use the tokenizer directly for accurate counting.
		const baseBreakdown = calculateTokenBreakdown(
			[systemMessage, ...messages],
			tokenizer,
			message => {
				try {
					// For system message, always use tokenizer directly to avoid cache misses
					if (message.role === 'system') {
						return tokenizer.countTokens(message);
					}
					// For other messages, use cached token counts
					const tokens = getMessageTokens(message);
					// Ensure we always return a valid number
					return typeof tokens === 'number' && !Number.isNaN(tokens)
						? tokens
						: 0;
				} catch {
					// Fallback to simple estimation if tokenization fails
					return Math.ceil(
						((message.content || '') + (message.role || '')).length / 4,
					);
				}
			},
		);

		// Clean up tokenizer resources
		if (tokenizer.free) {
			tokenizer.free();
		}

		// Tool definitions tokens count only the tools actually exposed to the
		// model (profile + mode filtered), and only when native tool calling is
		// active — under XML/JSON fallback the definitions are already counted
		// inside the system prompt above.
		const toolDefinitions = nativeToolsDisabled
			? 0
			: calculateToolDefinitionsTokens(availableNames.length);

		const breakdown = {
			...baseBreakdown,
			toolDefinitions,
			total: baseBreakdown.total + toolDefinitions,
		};

		// Get context limit: session override takes priority
		const sessionLimit = getSessionContextLimit();
		const contextLimit =
			sessionLimit ??
			(await getModelContextLimit(model, {
				providerConfig: client?.getProviderConfig(),
			}));

		return React.createElement(UsageDisplay, {
			key: generateKey('usage'),
			provider,
			model,
			contextLimit,
			currentTokens: breakdown.total,
			breakdown,
			messages,
			tokenizerName,
			getMessageTokens,
		});
	},
};
