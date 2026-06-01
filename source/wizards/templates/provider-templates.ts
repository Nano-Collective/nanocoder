import type {OpenRouterParameters, ProviderConfig} from '../../types/config';

/**
 * Field input type used by the wizard renderer to pick the right widget:
 *   - 'string'  (default): free-form text input.
 *   - 'boolean': Yes/No select. Stored as the string literal "true" / "false"
 *     in the answers map so the rest of the pipeline (Record<string, string>)
 *     stays uniform.
 *   - 'array':   free-form text input that the consuming buildConfig parses as
 *     a comma-separated list. The renderer only adjusts the prompt hint.
 */
export type TemplateFieldType = 'string' | 'boolean' | 'array';

export interface TemplateField {
	name: string;
	prompt: string;
	type?: TemplateFieldType; // Defaults to 'string'.
	default?: string;
	required?: boolean;
	sensitive?: boolean; // For API keys, passwords, etc.
	validator?: (value: string) => string | undefined; // Return error message if invalid
}

/**
 * Parse a comma-separated `array` field value into a clean string list.
 * Centralised so every template uses the same trim/empty-filter behaviour.
 */
function parseArrayField(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(',')
		.map(v => v.trim())
		.filter(Boolean);
}

export interface ProviderTemplate {
	id: string;
	name: string;
	fields: TemplateField[];
	buildConfig: (answers: Record<string, string>) => ProviderConfig;
}

const urlValidator = (value: string): string | undefined => {
	if (!value) return undefined;
	try {
		const url = new URL(value);

		// Check protocol - allow both HTTP and HTTPS
		// Users may have legitimate reasons for HTTP (VPNs, internal networks,
		// Ollama which doesn't use API keys, etc.)
		if (!['http:', 'https:'].includes(url.protocol)) {
			return 'URL must use http or https protocol';
		}

		return undefined;
	} catch {
		return 'Invalid URL format';
	}
};

// The wizard only collects a handful of OpenRouter knobs because TUI prompts
// are linear strings — the full surface (provider routing, plugins, fallback
// models, etc.) is documented in the OpenRouter provider docs and edited
// directly in agents.config.json by power users. The wizard's job is to make
// the basics discoverable, not to be a config editor.
const OPENROUTER_SERVICE_TIERS = ['flex', 'priority'] as const;
const OPENROUTER_REASONING_EFFORTS = [
	'xhigh',
	'high',
	'medium',
	'low',
	'minimal',
	'none',
] as const;
const OPENROUTER_SORT_KEYS = ['price', 'throughput', 'latency'] as const;

/**
 * Build a validator that accepts an empty value (the field is optional) or any
 * member of `validValues`, and otherwise returns a "must be one of" message.
 */
function createEnumValidator(
	validValues: readonly string[],
	label: string,
): (value: string) => string | undefined {
	return value => {
		if (!value) return undefined;
		if (!validValues.includes(value)) {
			return `${label} must be one of: ${validValues.join(', ')}`;
		}
		return undefined;
	};
}

const openrouterServiceTierValidator = createEnumValidator(
	OPENROUTER_SERVICE_TIERS,
	'Service tier',
);
const openrouterReasoningEffortValidator = createEnumValidator(
	OPENROUTER_REASONING_EFFORTS,
	'Reasoning effort',
);
const openrouterSortValidator = createEnumValidator(
	OPENROUTER_SORT_KEYS,
	'Sort',
);

/**
 * Assemble the `openrouter` block from wizard answers. Returns `undefined`
 * when the user left every option blank, so the generated config stays clean
 * (no empty `"openrouter": {}` entry).
 *
 * Boolean fields arrive as the strings "true" / "false" because the wizard's
 * answer map is `Record<string, string>` — we compare against "true" rather
 * than truthiness so empty / "false" / missing all behave the same.
 */
function buildOpenRouterBlock(
	answers: Record<string, string>,
): OpenRouterParameters | undefined {
	const block: OpenRouterParameters = {};

	const provider: NonNullable<OpenRouterParameters['provider']> = {};
	if (answers.sortBy) {
		provider.sort = answers.sortBy as 'price' | 'throughput' | 'latency';
	}
	if (answers.allowFallbacks === 'true' || answers.allowFallbacks === 'false') {
		provider.allow_fallbacks = answers.allowFallbacks === 'true';
	}
	if (answers.zdr === 'true' || answers.zdr === 'false') {
		provider.zdr = answers.zdr === 'true';
	}
	const order = parseArrayField(answers.providerOrder);
	if (order.length > 0) {
		provider.order = order;
	}
	if (Object.keys(provider).length > 0) {
		block.provider = provider;
	}

	if (answers.reasoningEffort) {
		block.reasoning = {
			effort: answers.reasoningEffort as
				| 'xhigh'
				| 'high'
				| 'medium'
				| 'low'
				| 'minimal'
				| 'none',
		};
	}

	if (answers.serviceTier) {
		block.service_tier = answers.serviceTier as 'flex' | 'priority';
	}

	const fallbackModels = parseArrayField(answers.fallbackModels);
	if (fallbackModels.length > 0) {
		block.models = fallbackModels;
	}

	return Object.keys(block).length > 0 ? block : undefined;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
	{
		id: 'ollama',
		name: 'Ollama',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'Ollama',
				required: true,
			},
			{
				name: 'baseUrl',
				prompt: 'Base URL',
				default: 'http://localhost:11434/v1',
				validator: urlValidator,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'ollama',
			baseUrl: answers.baseUrl || 'http://localhost:11434/v1',
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'llama-cpp',
		name: 'llama.cpp server',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'llama-cpp',
				required: true,
			},
			{
				name: 'baseUrl',
				prompt: 'Base URL',
				default: 'http://localhost:8080/v1',
				validator: urlValidator,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'llama-cpp',
			baseUrl: answers.baseUrl || 'http://localhost:8080/v1',
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'mlx-server',
		name: 'MLX Server',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'MLX Server',
				required: true,
			},
			{
				name: 'baseUrl',
				prompt: 'Base URL',
				default: 'http://localhost:8080/v1',
				validator: urlValidator,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'MLX Server',
			baseUrl: answers.baseUrl || 'http://localhost:8080/v1',
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'lmstudio',
		name: 'LM Studio',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'LM Studio',
				required: true,
			},
			{
				name: 'baseUrl',
				prompt: 'Base URL',
				default: 'http://localhost:1234/v1',
				validator: urlValidator,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'LM Studio',
			baseUrl: answers.baseUrl || 'http://localhost:1234/v1',
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'gemini',
		name: 'Google Gemini',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'Google Gemini',
			},
			{
				name: 'apiKey',
				prompt: 'API Key (from https://aistudio.google.com/apikey)',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'Google Gemini',
			sdkProvider: 'google',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			apiKey: answers.apiKey,
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'openrouter',
		name: 'OpenRouter',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'OpenRouter',
			},
			{
				name: 'apiKey',
				prompt: 'API Key',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
			{
				name: 'serviceTier',
				prompt:
					'Service tier — "flex" (cheaper/slower) or "priority" (faster/pricier). Leave empty for default routing',
				default: '',
				validator: openrouterServiceTierValidator,
			},
			{
				name: 'reasoningEffort',
				prompt:
					'Reasoning effort — xhigh / high / medium / low / minimal / none. Leave empty if the model does not use reasoning',
				default: '',
				validator: openrouterReasoningEffortValidator,
			},
			{
				name: 'sortBy',
				prompt:
					'Provider sort — price / throughput / latency. Leave empty for OpenRouter default',
				default: '',
				validator: openrouterSortValidator,
			},
			{
				name: 'providerOrder',
				prompt:
					'Preferred provider order (comma-separated, e.g. "Anthropic, OpenAI"). Leave empty to let OpenRouter decide',
				type: 'array',
				default: '',
			},
			{
				name: 'allowFallbacks',
				prompt:
					'Allow OpenRouter to fall back to other providers if your preferred ones fail?',
				type: 'boolean',
				default: '',
			},
			{
				name: 'zdr',
				prompt:
					'Enforce Zero Data Retention? Restricts routing to providers that contractually do not retain prompt data',
				type: 'boolean',
				default: '',
			},
			{
				name: 'fallbackModels',
				prompt:
					'Fallback model list (comma-separated, e.g. "openai/gpt-4o, anthropic/claude-3.5-sonnet"). Leave empty for no fallback',
				type: 'array',
				default: '',
			},
		],
		buildConfig: answers => {
			const config: ProviderConfig = {
				name: answers.providerName || 'OpenRouter',
				baseUrl: 'https://openrouter.ai/api/v1',
				apiKey: answers.apiKey,
				models: parseArrayField(answers.model),
			};
			const openrouter = buildOpenRouterBlock(answers);
			if (openrouter) {
				config.openrouter = openrouter;
			}
			return config;
		},
	},
	{
		id: 'openai',
		name: 'OpenAI',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'OpenAI',
			},
			{
				name: 'apiKey',
				prompt: 'API Key',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
			{
				name: 'organizationId',
				prompt: 'Organization ID (optional)',
				required: false,
			},
		],
		buildConfig: answers => {
			const config: ProviderConfig = {
				name: answers.providerName || 'OpenAI',
				baseUrl: 'https://api.openai.com/v1',
				apiKey: answers.apiKey,
				models: parseArrayField(answers.model),
			};
			if (answers.organizationId) {
				config.organizationId = answers.organizationId;
			}
			return config;
		},
	},
	{
		id: 'anthropic',
		name: 'Anthropic Claude',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'Anthropic Claude',
			},
			{
				name: 'apiKey',
				prompt: 'API Key',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'Anthropic Claude',
			sdkProvider: 'anthropic',
			baseUrl: 'https://api.anthropic.com/v1',
			apiKey: answers.apiKey,
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'mistral',
		name: 'Mistral AI',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'Mistral AI',
			},
			{
				name: 'apiKey',
				prompt: 'API Key',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'Mistral AI',
			baseUrl: 'https://api.mistral.ai/v1',
			apiKey: answers.apiKey,
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'z-ai',
		name: 'Z.ai',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'Z.ai',
				required: true,
			},
			{
				name: 'apiKey',
				prompt: 'API Key',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'Z.ai',
			baseUrl: 'https://api.z.ai/api/paas/v4/',
			apiKey: answers.apiKey,
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'z-ai-coding',
		name: 'Z.ai Coding Subscription',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'Z.ai Coding Subscription',
				required: true,
			},
			{
				name: 'apiKey',
				prompt: 'API Key',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'Z.ai Coding Subscription',
			baseUrl: 'https://api.z.ai/api/coding/paas/v4/',
			apiKey: answers.apiKey,
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'github-models',
		name: 'GitHub Models',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'GitHub Models',
			},
			{
				name: 'apiKey',
				prompt: 'GitHub Token (PAT with models:read scope)',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'GitHub Models',
			baseUrl: 'https://models.github.ai/inference',
			apiKey: answers.apiKey,
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'chatgpt-codex',
		name: 'ChatGPT / Codex',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'ChatGPT / Codex',
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated).',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'ChatGPT / Codex',
			baseUrl: 'https://chatgpt.com/backend-api/codex',
			models: parseArrayField(answers.model),
			sdkProvider: 'chatgpt-codex',
		}),
	},
	{
		id: 'github-copilot',
		name: 'GitHub Copilot',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'GitHub Copilot',
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated).',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'GitHub Copilot',
			baseUrl: 'https://api.githubcopilot.com',
			models: parseArrayField(answers.model),
			sdkProvider: 'github-copilot',
		}),
	},
	{
		id: 'kimi-code',
		name: 'Kimi Code',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'Kimi Code',
			},
			{
				name: 'apiKey',
				prompt: 'API Key',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: 'kimi-for-coding',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'Kimi Code',
			sdkProvider: 'anthropic',
			baseUrl: 'https://api.kimi.com/coding/v1',
			apiKey: answers.apiKey,
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'minimax-coding',
		name: 'MiniMax Coding Plan',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'MiniMax Coding',
			},
			{
				name: 'apiKey',
				prompt: 'API Key',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: 'MiniMax-M2.7',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'MiniMax Coding',
			sdkProvider: 'anthropic',
			baseUrl: 'https://api.minimax.io/anthropic/v1',
			apiKey: answers.apiKey,
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'poe',
		name: 'Poe',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'Poe',
			},
			{
				name: 'apiKey',
				prompt: 'API Key (from poe.com/api_key)',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'Poe',
			baseUrl: 'https://api.poe.com/v1',
			apiKey: answers.apiKey,
			models: parseArrayField(answers.model),
		}),
	},
	{
		id: 'custom',
		name: 'Custom Provider',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				required: true,
			},
			{
				name: 'baseUrl',
				prompt: 'Base URL',
				required: true,
				validator: urlValidator,
			},
			{
				name: 'apiKey',
				prompt: 'API Key (optional)',
				required: false,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				required: true,
			},
			{
				name: 'timeout',
				prompt: 'Request timeout (ms)',
				default: '30000',
				validator: value => {
					if (!value) return undefined;
					const num = Number(value);
					if (Number.isNaN(num) || num <= 0) {
						return 'Timeout must be a positive number';
					}
					return undefined;
				},
			},
		],
		buildConfig: answers => {
			const config: ProviderConfig = {
				name: answers.providerName,
				baseUrl: answers.baseUrl,
				models: parseArrayField(answers.model),
			};
			if (answers.apiKey) {
				config.apiKey = answers.apiKey;
			}
			if (answers.timeout) {
				config.timeout = Number(answers.timeout);
			}
			return config;
		},
	},
];
