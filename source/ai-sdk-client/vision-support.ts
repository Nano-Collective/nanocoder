import type {SdkProvider} from '@/types/config';

/**
 * Model-name fragments that identify a vision-capable model. Matched
 * case-insensitively as substrings, so `gpt-4o-2024-08-06`, `llava:13b`, and
 * `qwen2.5-vl-7b-instruct` all resolve to vision-capable. The list errs toward
 * well-known multimodal families; an unknown OpenAI-compatible model is treated
 * as text-only so we warn rather than silently send bytes a model will reject.
 */
const VISION_MODEL_MARKERS: readonly string[] = [
	// OpenAI
	'gpt-4o',
	'gpt-4.1',
	'gpt-4-turbo',
	'gpt-4-vision',
	'gpt-5',
	'o1',
	'o3',
	'o4',
	'chatgpt-4o',
	// Anthropic (also covered by the provider check below)
	'claude',
	// Google (also covered by the provider check below)
	'gemini',
	'gemma-3',
	// Meta
	'llama-3.2',
	'llama3.2',
	'llama-4',
	'llama4',
	// Mistral
	'pixtral',
	'mistral-small-3',
	// Qwen
	'qwen-vl',
	'qwen2-vl',
	'qwen2.5-vl',
	'qwen3-vl',
	'qvq',
	// Other open multimodal models
	'llava',
	'bakllava',
	'moondream',
	'minicpm-v',
	'internvl',
	'cogvlm',
	'idefics',
	'molmo',
	'phi-3-vision',
	'phi-3.5-vision',
	'phi-4-multimodal',
	'step-1v',
	'grok-vision',
	'grok-2-vision',
	'grok-4',
];

/**
 * Best-effort check for whether the active model can accept image input.
 *
 * Dedicated multimodal providers (Anthropic, Google) are vision-capable across
 * their current model lineups, so they resolve to `true` regardless of model
 * name. For OpenAI-compatible and Copilot endpoints — which front everything
 * from frontier vision models to tiny local text models — we fall back to a
 * name heuristic.
 *
 * A `false` result is advisory: callers should warn the user rather than drop
 * the image, since the heuristic cannot know every model.
 */
export function modelSupportsVision(
	sdkProvider: SdkProvider | undefined,
	model: string,
): boolean {
	if (sdkProvider === 'anthropic' || sdkProvider === 'google') {
		return true;
	}

	const normalized = model.toLowerCase();
	return VISION_MODEL_MARKERS.some(marker => normalized.includes(marker));
}
