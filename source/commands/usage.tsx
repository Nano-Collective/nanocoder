/**
 * /usage command
 * Displays token usage statistics
 */

import React from 'react';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {UsageDisplay} from '@/components/usage/usage-display';
import {getAppConfig} from '@/config/index';
import {getToolManager} from '@/message-handler';
import {getModelContextLimit, getModelPricing, getSessionContextLimit} from '@/models/index';
import {generateKey} from '@/session/key-generator';
import {createTokenizer} from '@/tokenization/index';
import type {Command} from '@/types/commands';
import type {TuneConfig} from '@/types/config';
import {getTuneToolMode} from '@/types/config';
import type {ApiUsageSnapshot, DevelopmentMode, Message} from '@/types/core';
import type {CostBreakdown} from '@/types/usage';
import {
	calculateTokenBreakdown,
	calculateToolDefinitionsTokensFromDefs,
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
			lastApiUsage?: ApiUsageSnapshot | null;
			apiCallHistory?: import('@/types/core').ApiCallRecord[];
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

		// Tool definitions tokens count only the tools actually exposed to the
		// model (profile + mode filtered), and only when native tool calling is
		// active — under XML/JSON fallback the definitions are already counted
		// inside the system prompt above. Serialize the real definitions so the
		// estimate tracks the provider-reported count.
		const toolDefinitions =
			nativeToolsDisabled || !toolManager
				? 0
				: calculateToolDefinitionsTokensFromDefs(
						toolManager.getFilteredTools(availableNames),
						tokenizer,
					);

		// Clean up tokenizer resources
		if (tokenizer.free) {
			tokenizer.free();
		}

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

		// Fetch pricing and compute cost (best-effort: null when unavailable)
		let cost: CostBreakdown | undefined;
		try {
			const pricing = await getModelPricing(model);
			if (pricing) {
				// ---- Current-context cost (same as Phase 2) ----
				const snapshot = metadata.lastApiUsage;
				const isSnapshotFresh =
					snapshot && snapshot.atMessageCount >= messages.length;

				let currentContextCost: number;
				if (
					isSnapshotFresh &&
					snapshot.inputTokens != null &&
					snapshot.outputTokens != null
				) {
					currentContextCost =
						(pricing.input * snapshot.inputTokens +
							pricing.output * snapshot.outputTokens) /
						1_000_000;
				} else {
					currentContextCost =
						(pricing.input * breakdown.total) / 1_000_000;
				}

				// ---- Cumulative session + per-provider (from history) ----
				const history = metadata.apiCallHistory ?? [];
				let cumulativeSession = 0;
				const perProvider: Record<string, number> = {};
				const pricingCache = new Map<string, typeof pricing>();

				for (const record of history) {
					const recordPricing = pricingCache.get(record.model)
						?? await getModelPricing(record.model)
						?? pricing;

					pricingCache.set(record.model, recordPricing);

					const inputTokens = record.inputTokens ?? 0;
					const outputTokens = record.outputTokens ?? 0;
					const callCost =
						(recordPricing.input * inputTokens +
							recordPricing.output * outputTokens) /
						1_000_000;

					cumulativeSession += callCost;
					perProvider[record.provider] =
						(perProvider[record.provider] ?? 0) + callCost;
				}

				cost = {
					currentContext: currentContextCost,
					cumulativeSession: history.length === 0 ? NaN : cumulativeSession,
					perProvider: Object.keys(perProvider).length > 1
						? perProvider
						: undefined,
				};
			}
		} catch {
			// Best-effort: no pricing available — display will show "—"
		}

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
			cost,
		});
	},
};
