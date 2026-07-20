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

/**
 * Local model server (Ollama, llama.cpp, MLX, LM Studio): provider name +
 * base URL + models, no API key. `configFallbackName` defaults to the field
 * default but can differ (Ollama stores lowercase "ollama").
 */
function localServerTemplate(opts: {
	id: string;
	name: string;
	defaultProviderName: string;
	defaultBaseUrl: string;
	configFallbackName?: string;
}): ProviderTemplate {
	const fallbackName = opts.configFallbackName ?? opts.defaultProviderName;
	return {
		id: opts.id,
		name: opts.name,
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: opts.defaultProviderName,
				required: true,
			},
			{
				name: 'baseUrl',
				prompt: 'Base URL',
				default: opts.defaultBaseUrl,
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
			name: answers.providerName || fallbackName,
			baseUrl: answers.baseUrl || opts.defaultBaseUrl,
			models: parseArrayField(answers.model),
		}),
	};
}

/**
 * Hosted provider keyed by an API key: provider name + API key + models, with
 * a fixed base URL and optional `sdkProvider`.
 */
function apiKeyTemplate(opts: {
	id: string;
	name: string;
	baseUrl: string;
	defaultProviderName?: string;
	apiKeyPrompt?: string;
	modelDefault?: string;
	sdkProvider?: ProviderConfig['sdkProvider'];
	providerNameRequired?: boolean;
}): ProviderTemplate {
	const defaultProviderName = opts.defaultProviderName ?? opts.name;
	const providerNameField: TemplateField = {
		name: 'providerName',
		prompt: 'Provider name',
		default: defaultProviderName,
	};
	if (opts.providerNameRequired) {
		providerNameField.required = true;
	}
	return {
		id: opts.id,
		name: opts.name,
		fields: [
			providerNameField,
			{
				name: 'apiKey',
				prompt: opts.apiKeyPrompt ?? 'API Key',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: opts.modelDefault ?? '',
				required: true,
			},
		],
		buildConfig: answers => {
			const config: ProviderConfig = {
				name: answers.providerName || defaultProviderName,
				baseUrl: opts.baseUrl,
				apiKey: answers.apiKey,
				models: parseArrayField(answers.model),
			};
			if (opts.sdkProvider) {
				config.sdkProvider = opts.sdkProvider;
			}
			return config;
		},
	};
}

/**
 * OAuth/subscription provider (ChatGPT/Codex, GitHub Copilot): provider name +
 * models only — the token comes from a device-flow login, not a wizard field.
 */
function oauthProviderTemplate(opts: {
	id: string;
	name: string;
	baseUrl: string;
	sdkProvider: ProviderConfig['sdkProvider'];
}): ProviderTemplate {
	return {
		id: opts.id,
		name: opts.name,
		fields: [
			{name: 'providerName', prompt: 'Provider name', default: opts.name},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated).',
				default: '',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || opts.name,
			baseUrl: opts.baseUrl,
			models: parseArrayField(answers.model),
			sdkProvider: opts.sdkProvider,
		}),
	};
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
	localServerTemplate({
		id: 'ollama',
		name: 'Ollama',
		defaultProviderName: 'Ollama',
		defaultBaseUrl: 'http://localhost:11434/v1',
		configFallbackName: 'ollama',
	}),
	localServerTemplate({
		id: 'llama-cpp',
		name: 'llama.cpp server',
		defaultProviderName: 'llama-cpp',
		defaultBaseUrl: 'http://localhost:8080/v1',
	}),
	localServerTemplate({
		id: 'mlx-server',
		name: 'MLX Server',
		defaultProviderName: 'MLX Server',
		defaultBaseUrl: 'http://localhost:8080/v1',
	}),
	localServerTemplate({
		id: 'lmstudio',
		name: 'LM Studio',
		defaultProviderName: 'LM Studio',
		defaultBaseUrl: 'http://localhost:1234/v1',
	}),
	apiKeyTemplate({
		id: 'gemini',
		name: 'Google Gemini',
		baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
		apiKeyPrompt: 'API Key (from https://aistudio.google.com/apikey)',
		sdkProvider: 'google',
	}),
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
	apiKeyTemplate({
		id: 'requesty',
		name: 'Requesty',
		baseUrl: 'https://router.requesty.ai/v1',
		apiKeyPrompt: 'API Key (from https://app.requesty.ai/api-keys)',
		modelDefault: 'openai/gpt-4o-mini',
	}),
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
	apiKeyTemplate({
		id: 'anthropic',
		name: 'Anthropic Claude',
		baseUrl: 'https://api.anthropic.com/v1',
		sdkProvider: 'anthropic',
	}),
	apiKeyTemplate({
		id: 'mistral',
		name: 'Mistral AI',
		baseUrl: 'https://api.mistral.ai/v1',
	}),
	apiKeyTemplate({
		id: 'z-ai',
		name: 'Z.ai',
		baseUrl: 'https://api.z.ai/api/paas/v4/',
		providerNameRequired: true,
	}),
	apiKeyTemplate({
		id: 'z-ai-coding',
		name: 'Z.ai Coding Subscription',
		baseUrl: 'https://api.z.ai/api/coding/paas/v4/',
		providerNameRequired: true,
	}),
	apiKeyTemplate({
		id: 'github-models',
		name: 'GitHub Models',
		baseUrl: 'https://models.github.ai/inference',
		apiKeyPrompt: 'GitHub Token (PAT with models:read scope)',
	}),
	oauthProviderTemplate({
		id: 'chatgpt-codex',
		name: 'ChatGPT / Codex',
		baseUrl: 'https://chatgpt.com/backend-api/codex',
		sdkProvider: 'chatgpt-codex',
	}),
	oauthProviderTemplate({
		id: 'github-copilot',
		name: 'GitHub Copilot',
		baseUrl: 'https://api.githubcopilot.com',
		sdkProvider: 'github-copilot',
	}),
	apiKeyTemplate({
		id: 'kimi-code',
		name: 'Kimi Code',
		baseUrl: 'https://api.kimi.com/coding/v1',
		modelDefault: 'kimi-for-coding',
		sdkProvider: 'anthropic',
	}),
	apiKeyTemplate({
		id: 'minimax-coding',
		name: 'MiniMax Coding Plan',
		defaultProviderName: 'MiniMax Coding',
		baseUrl: 'https://api.minimax.io/anthropic/v1',
		modelDefault: 'MiniMax-M3,MiniMax-M2.7',
		sdkProvider: 'anthropic',
	}),
	apiKeyTemplate({
		id: 'poe',
		name: 'Poe',
		baseUrl: 'https://api.poe.com/v1',
		apiKeyPrompt: 'API Key (from poe.com/api_key)',
	}),
	apiKeyTemplate({
		id: 'atlas-cloud',
		name: 'Atlas Cloud',
		baseUrl: 'https://api.atlascloud.ai/v1',
		apiKeyPrompt: 'API Key (from atlascloud.ai/developer)',
	}),
	apiKeyTemplate({
		id: 'together',
		name: 'Together AI',
		baseUrl: 'https://api.together.ai/v1',
		apiKeyPrompt: 'API Key (from api.together.ai/settings/api-keys)',
	}),
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
