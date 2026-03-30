import {useEffect, useRef} from 'react';
import {getModelContextLimit} from '@/models/index';
import type {ToolManager} from '@/tools/tool-manager';
import type {TuneConfig} from '@/types/config';
import type {DevelopmentMode, Message} from '@/types/core';
import type {Tokenizer} from '@/types/tokenization';
import {
	calculateTokenBreakdown,
	calculateToolDefinitionsTokens,
} from '@/usage/calculator';
import {getLastBuiltPrompt} from '@/utils/prompt-builder';

interface UseContextPercentageProps {
	currentModel: string;
	messages: Message[];
	tokenizer: Tokenizer;
	getMessageTokens: (message: Message) => number;
	toolManager: ToolManager | null;
	streamingTokenCount: number;
	contextLimit: number | null;
	setContextPercentUsed: (value: number | null) => void;
	setContextLimit: (value: number | null) => void;
	developmentMode?: DevelopmentMode;
	tune?: TuneConfig;
}

export function useContextPercentage({
	currentModel,
	messages,
	tokenizer,
	getMessageTokens,
	toolManager,
	streamingTokenCount,
	contextLimit,
	setContextPercentUsed,
	setContextLimit,
	developmentMode = 'normal',
	tune,
}: UseContextPercentageProps): void {
	const contextLimitRef = useRef<number | null>(null);
	const lastModelRef = useRef<string>('');

	// Effect 1: Resolve context limit when model changes
	useEffect(() => {
		if (!currentModel) {
			contextLimitRef.current = null;
			setContextLimit(null);
			setContextPercentUsed(null);
			return;
		}

		if (currentModel === lastModelRef.current) return;
		lastModelRef.current = currentModel;

		let cancelled = false;

		void getModelContextLimit(currentModel).then(limit => {
			if (cancelled) return;
			contextLimitRef.current = limit;
			setContextLimit(limit);
			if (!limit) {
				setContextPercentUsed(null);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [currentModel, setContextLimit, setContextPercentUsed]);

	// Effect 2: Recalculate percentage when messages, streaming tokens, or context limit change
	useEffect(() => {
		const limit = contextLimitRef.current;
		if (!limit) {
			setContextPercentUsed(null);
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
		// When tools are disabled (XML fallback), definitions are in the system prompt
		const nativeToolsDisabled = tune?.enabled && tune.disableNativeTools;
		const toolDefTokens =
			toolManager && !nativeToolsDisabled
				? calculateToolDefinitionsTokens(
						Object.keys(toolManager.getToolRegistry()).length,
					)
				: 0;

		const total = breakdown.total + toolDefTokens + streamingTokenCount;
		const percent = Math.round((total / limit) * 100);
		setContextPercentUsed(percent);
		// contextLimit is included to re-trigger calculation after async limit resolution
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		messages,
		tokenizer,
		getMessageTokens,
		toolManager,
		streamingTokenCount,
		setContextPercentUsed,
		tune,
	]);
}
