export interface ModelEntry {
	id: string; // OpenRouter model ID (e.g., "openai/gpt-4")
	name: string; // Display name
	author: string; // Model creator/organization (e.g., "Meta", "Anthropic", "Qwen")
	size: string; // Context length formatted (e.g., "128K", "1M")
	local: boolean; // Open weights - can be run locally
	api: boolean; // Available via hosted API (OpenRouter, etc.)
	contextLength: number; // Raw context length in tokens
	created: number; // Unix timestamp of model creation
	quality: {
		cost: number; // Cost-effectiveness (10 = free/cheap, 1 = very expensive)
	};
	costType: 'free' | 'paid';
	costDetails: string; // e.g., "$1.25/M in, $5.00/M out"
	hasToolSupport: boolean; // Whether model supports tool/function calling
}
