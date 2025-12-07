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
		new URL(value);
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
				default: 'ollama',
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
		id: 'lmstudio',
		name: 'LM Studio',
		fields: [
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'lmstudio',
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
			name: answers.providerName || 'lmstudio',
			baseUrl: answers.baseUrl || 'http://localhost:1234/v1',
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
				name: 'apiKey',
				prompt: 'API Key',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: 'z-ai/glm-4.6',
				required: true,
			},
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'OpenRouter',
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
				name: 'apiKey',
				prompt: 'API Key',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: 'gpt-5-codex',
				required: true,
			},
			{
				name: 'organizationId',
				prompt: 'Organization ID (optional)',
				required: false,
			},
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'openai',
			},
		],
		buildConfig: answers => {
			const config: ProviderConfig = {
				name: answers.providerName || 'openai',
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
				name: 'apiKey',
				prompt: 'API Key',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: 'claude-4-sonnet',
				required: true,
			},
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'anthropic',
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'anthropic',
			baseUrl: 'https://api.anthropic.com/v1',
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
				default: 'glm-4.6, glm-4.5-air',
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
				default: 'glm-4.6, glm-4.5-air',
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
				name: 'apiKey',
				prompt: 'GitHub Token (PAT with models:read scope)',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: 'openai/gpt-4o-mini',
				required: true,
			},
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'GitHub Models',
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
