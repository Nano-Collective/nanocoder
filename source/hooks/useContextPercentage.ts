import {useEffect, useRef} from 'react';
import {getModelContextLimit} from '@/models/index';
import type {ToolManager} from '@/tools/tool-manager';
import type {AIProviderConfig, TuneConfig} from '@/types/config';
import {getTuneToolMode} from '@/types/config';
import type {
	ApiUsageSnapshot,
	ContextSource,
	DevelopmentMode,
	Message,
} from '@/types/core';
import type {Tokenizer} from '@/types/tokenization';
import {
	calculateTokenBreakdown,
	calculateToolDefinitionsTokens,
} from '@/usage/calculator';
import {resolveContextUsage} from '@/usage/context-source';
import {getLastBuiltPrompt} from '@/utils/prompt-builder';

interface UseContextPercentageProps {
	currentModel: string;
	currentProvider: string;
	currentProviderConfig: AIProviderConfig | null;
	messages: Message[];
	tokenizer: Tokenizer;
	getMessageTokens: (message: Message) => number;
	toolManager: ToolManager | null;
	streamingTokenCount: number;
	contextLimit: number | null;
	lastApiUsage: ApiUsageSnapshot | null;
	setContextPercentUsed: (value: number | null) => void;
	setContextLimit: (value: number | null) => void;
	setContextSource: (value: ContextSource | null) => void;
	developmentMode?: DevelopmentMode;
	tune?: TuneConfig;
}

export function useContextPercentage({
	currentModel,
	currentProvider,
	currentProviderConfig,
	messages,
	tokenizer,
	getMessageTokens,
	toolManager,
	streamingTokenCount,
	contextLimit,
	lastApiUsage,
	setContextPercentUsed,
	setContextLimit,
	setContextSource,
	developmentMode = 'normal',
	tune,
}: UseContextPercentageProps): void {
	const contextLimitRef = useRef<number | null>(null);
	const lastResolvedKeyRef = useRef<string>('');

	// Effect 1: Resolve context limit when model or provider changes
	useEffect(() => {
		if (!currentModel) {
			contextLimitRef.current = null;
			lastResolvedKeyRef.current = '';
			setContextLimit(null);
			setContextPercentUsed(null);
			setContextSource(null);
			return;
		}

		const resolutionKey = `${currentProvider}:${currentModel}`;
		if (resolutionKey === lastResolvedKeyRef.current) return;
		lastResolvedKeyRef.current = resolutionKey;

		let cancelled = false;

		void getModelContextLimit(currentModel, {
			providerConfig: currentProviderConfig ?? undefined,
		}).then(limit => {
			if (cancelled) return;
			contextLimitRef.current = limit;
			setContextLimit(limit);
			if (!limit) {
				setContextPercentUsed(null);
				setContextSource(null);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [
		currentModel,
		currentProvider,
		currentProviderConfig,
		setContextLimit,
		setContextPercentUsed,
		setContextSource,
	]);

	// Effect 2: Recalculate percentage when messages, streaming tokens, or context limit change
	useEffect(() => {
		const limit = contextLimitRef.current;
		if (!limit) {
			setContextPercentUsed(null);
			setContextSource(null);
			return;
		}

		// Use the cached prompt which includes XML tool definitions when applicable
		const systemPrompt = getLastBuiltPrompt();
		const systemMessage: Message = {
			role: 'system',
			content: systemPrompt,
		};

		const breakdown = calculateTokenBreakdown(
			[systemMessage, ...messages],
			tokenizer,
			(message: Message) => {
				// System message won't be in the cache, use tokenizer directly
				if (message.role === 'system') {
					return tokenizer.countTokens(message);
				}
				return getMessageTokens(message);
			},
		);

		// Include tool definition overhead (only when native tool calling is active)
		// When tools are disabled (XML/JSON fallback), definitions are in the system prompt
		const nativeToolsDisabled = getTuneToolMode(tune) !== 'native';
		const toolDefTokens =
			toolManager && !nativeToolsDisabled
				? calculateToolDefinitionsTokens(
						Object.keys(toolManager.getToolRegistry()).length,
					)
				: 0;

		const total = breakdown.total + toolDefTokens + streamingTokenCount;

		// Prefer API-reported usage when it is fresh (the snapshot's message
		// count still matches the conversation); otherwise fall back to the
		// estimate computed above so the figure never lags the conversation.
		const {percent, source} = resolveContextUsage({
			estimatedTotalTokens: total,
			apiSnapshot: lastApiUsage,
			currentMessageCount: messages.length,
			contextLimit: limit,
		});
		setContextPercentUsed(percent);
		setContextSource(source);
		// contextLimit is included to re-trigger calculation after async limit resolution
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		messages,
		tokenizer,
		getMessageTokens,
		toolManager,
		streamingTokenCount,
		lastApiUsage,
		setContextPercentUsed,
		setContextSource,
		tune,
	]);
}
