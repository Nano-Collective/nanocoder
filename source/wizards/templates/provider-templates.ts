import type {ProviderConfig} from '../../types/config';

export interface TemplateField {
	name: string;
	prompt: string;
	default?: string;
	required?: boolean;
	sensitive?: boolean; // For API keys, passwords, etc.
	validator?: (value: string) => string | undefined; // Return error message if invalid
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
		],
		buildConfig: answers => ({
			name: answers.providerName || 'OpenRouter',
			baseUrl: 'https://openrouter.ai/api/v1',
			apiKey: answers.apiKey,
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
		}),
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
				models: answers.model
					.split(',')
					.map(m => m.trim())
					.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
			models: answers.model
				.split(',')
				.map(m => m.trim())
				.filter(Boolean),
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
				models: answers.model
					.split(',')
					.map(m => m.trim())
					.filter(Boolean),
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
