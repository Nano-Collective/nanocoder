/**
 * /usage command
 * Displays token usage statistics
 */

import React from 'react';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {UsageDisplay} from '@/components/usage/usage-display';
import {getAppConfig} from '@/config/index';
import {
	buildSystemPrompt,
	getLastBuiltPrompt,
} from '@/conversation/prompt-builder';
import {getToolManager} from '@/message-handler';
import {
	getModelContextLimit,
	getModelPricing,
	getSessionContextLimit,
} from '@/models/index';
import {createTokenizer} from '@/tokenization/index';
import type {Command} from '@/types/commands';
import type {TuneConfig} from '@/types/config';
import {getTuneToolMode} from '@/types/config';
import type {
	ApiCallRecord,
	ApiUsageSnapshot,
	DevelopmentMode,
	Message,
} from '@/types/core';
import type {CostBreakdown} from '@/types/usage';
import {
	calculateTokenBreakdown,
	calculateToolDefinitionsTokensFromDefs,
} from '@/usage/calculator';
import {calculateUsageCost} from '@/usage/response-usage';
import {generateKey} from '@/utils/key-generator';
import {estimateTokens} from '@/utils/token-calculator';
import {isLocalURL} from '@/utils/url-utils';

interface CostTally {
	known: number; // Sum of the calls whose cost is known
	pricedHosted: boolean; // A hosted call had a price
	unpriced: boolean; // A call had no known price
}

// Unknown when an unpriced call has nothing but free local calls beside it:
// $0.00 would say the hosted call was free. Partial when it leaves calls out.
function settle(tally: CostTally): {value: number; partial: boolean} {
	if (tally.unpriced && !tally.pricedHosted)
		return {value: NaN, partial: false};
	return {value: tally.known, partial: tally.unpriced};
}

/** Session and per-provider spend, priced call by call from the history. */
async function historyCost(
	history: ApiCallRecord[],
): Promise<Omit<CostBreakdown, 'currentContext'>> {
	if (history.length === 0) return {cumulativeSession: NaN};

	// Calls made on a local server are free, whatever models.dev lists
	// under the same id.
	const isLocalCall = (r: ApiCallRecord) =>
		Boolean(r.baseURL && isLocalURL(r.baseURL));
	const hostedModels = [
		...new Set(history.filter(r => !isLocalCall(r)).map(r => r.model)),
	];
	const pricing = new Map(
		await Promise.all(
			hostedModels.map(async m => [m, await getModelPricing(m)] as const),
		),
	);

	const session: CostTally = {known: 0, pricedHosted: false, unpriced: false};
	const byProvider = new Map<string, CostTally>();
	for (const record of history) {
		const local = isLocalCall(record);
		const recordPricing = pricing.get(record.model);
		const callCost = local
			? 0
			: recordPricing
				? (calculateUsageCost(record, recordPricing) ?? 0)
				: NaN;
		const provider = byProvider.get(record.provider) ?? {
			known: 0,
			pricedHosted: false,
			unpriced: false,
		};
		byProvider.set(record.provider, provider);
		for (const tally of [session, provider]) {
			if (!Number.isFinite(callCost)) {
				tally.unpriced = true;
				continue;
			}
			tally.known += callCost;
			if (!local) tally.pricedHosted = true;
		}
	}

	// No prototype, so a provider named __proto__ or constructor is kept.
	const perProvider: Record<string, number> = Object.create(null);
	const partialProviders: string[] = [];
	for (const [name, tally] of byProvider) {
		const {value, partial} = settle(tally);
		perProvider[name] = value;
		if (partial) partialProviders.push(name);
	}
	const total = settle(session);
	return {
		cumulativeSession: total.value,
		sessionPartial: total.partial,
		perProvider: byProvider.size > 1 ? perProvider : undefined,
		partialProviders,
	};
}

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
				encode: (text: string) => estimateTokens(text || ''),
				countTokens: (message: Message) =>
					estimateTokens((message.content || '') + (message.role || '')),
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
				undefined,
				toolManager,
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
					return estimateTokens((message.content || '') + (message.role || ''));
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
		const sessionLimit = getSessionContextLimit({provider, model});
		const contextLimit =
			sessionLimit ??
			(await getModelContextLimit(model, {
				providerConfig: client?.getProviderConfig(),
			}));

		// Fetch pricing and compute cost (best-effort: show '—' when unavailable)
		let cost: CostBreakdown = {
			currentContext: NaN,
			cumulativeSession: NaN,
		};
		try {
			// A local server (Ollama, LM Studio) is free, whatever models.dev
			// lists under the same id.
			const baseURL = client?.getProviderConfig()?.config.baseURL;
			const pricing =
				baseURL && isLocalURL(baseURL) ? null : await getModelPricing(model);
			let currentContext = NaN;
			if (pricing) {
				// ---- Current-context cost (same as Phase 2) ----
				const snapshot = metadata.lastApiUsage;
				const isSnapshotFresh =
					snapshot && snapshot.atMessageCount >= messages.length;

				const reportedContextCost = isSnapshotFresh
					? calculateUsageCost(snapshot, pricing)
					: undefined;
				currentContext =
					reportedContextCost ?? (pricing.input * breakdown.total) / 1_000_000;
			}
			// The history is priced call by call, so it does not depend on
			// whether the active model has a price.
			cost = {
				currentContext,
				...(await historyCost(metadata.apiCallHistory ?? [])),
			};
		} catch {
			// Best-effort: already initialized to NaN — display will show "—"
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
