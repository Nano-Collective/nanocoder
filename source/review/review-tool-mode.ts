import {getAppConfig} from '@/config/index';
import {getTuneToolMode, type TuneConfig} from '@/types/config';
import type {ReviewToolMode} from './review-agent';

/** Match the chat loop's decision between native tool calls and text fallback. */
export function resolveReviewToolMode(
	provider: string,
	model: string,
	tune: TuneConfig | undefined,
): ReviewToolMode {
	const toolMode = getTuneToolMode(tune);
	const providerConfig = getAppConfig().providers?.find(
		candidate => candidate.name === provider,
	);
	const disabled =
		toolMode !== 'native' ||
		providerConfig?.disableTools === true ||
		(providerConfig?.disableToolModels?.includes(model) ?? false);
	return {disabled, format: toolMode === 'json' ? 'json' : 'xml'};
}
