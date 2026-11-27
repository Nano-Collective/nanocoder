import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {getAppConfig} from '@/config/index';
import {buildSystemPrompt} from '@/conversation/prompt-builder';
import {fileMutationPaths} from '@/tools/file-ops/file-mutating-tools';
import type {ToolManager} from '@/tools/tool-manager';
import type {SystemPromptConfig, TuneConfig} from '@/types/config';
import type {DevelopmentMode} from '@/types/core';
import type {ToolCallLog} from './conversation.js';

export interface ComposePlainSystemPromptOptions {
	developmentMode: DevelopmentMode;
	tune: TuneConfig;
	availableToolNames: string[];
	toolsDisabled: boolean;
	fallbackToolFormat: 'xml' | 'json';
	systemPromptOverride?: SystemPromptConfig;
	model?: string;
	toolManager: ToolManager;
}

/** Compose the system prompt and fallback tool definitions used by plain runs. */
export function composePlainSystemPrompt(
	options: ComposePlainSystemPromptOptions,
): string {
	const basePrompt = buildSystemPrompt(
		options.developmentMode,
		options.tune,
		options.availableToolNames,
		options.toolsDisabled,
		options.systemPromptOverride,
		options.model,
		undefined,
		options.toolManager,
	);
	const toolsForPrompt = options.toolsDisabled
		? options.toolManager.getFilteredTools(options.availableToolNames)
		: {};
	return appendToolDefinitionsToPrompt(
		basePrompt,
		options.toolsDisabled,
		options.fallbackToolFormat,
		toolsForPrompt,
	);
}

/** Whether this provider/model pair disables tool calls in the project config. */
export function isToolCallingDisabled(
	provider: string,
	model: string,
): boolean {
	const providerConfig = getAppConfig().providers?.find(
		entry => entry.name === provider,
	);
	return providerConfig?.disableToolModels?.includes(model) ?? false;
}

/**
 * Summarize successful file-mutating calls in first-seen order. Failed and
 * refused calls do not contribute paths, and duplicate paths appear once.
 */
export function summarizeFileMutations(
	toolCalls: readonly Pick<ToolCallLog, 'name' | 'arguments' | 'error'>[],
): string[] {
	const filesChanged = new Set<string>();
	for (const call of toolCalls) {
		// The mutation paths are reported as the model gave them, including
		// paths such as ../x that the tool itself already accepted.
		if (call.error === null) {
			for (const filePath of fileMutationPaths(call.name, call.arguments)) {
				filesChanged.add(filePath);
			}
		}
	}
	return [...filesChanged];
}
