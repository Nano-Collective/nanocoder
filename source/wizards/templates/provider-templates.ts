import type {ProviderConfig} from '../../types/config';
import type {ModelsEndpointType} from '../utils/fetch-local-models';

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
	modelsEndpoint?: ModelsEndpointType; // Hint for fetching models from local providers
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
		modelsEndpoint: 'ollama',
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
		modelsEndpoint: 'openai-compatible',
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
		modelsEndpoint: 'openai-compatible',
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
		id: 'gemini',
		name: 'Google Gemini',
		fields: [
			{
				name: 'apiKey',
				prompt: 'API Key (from https://aistudio.google.com/apikey)',
				required: true,
				sensitive: true,
			},
			{
				name: 'model',
				prompt: 'Model name(s) (comma-separated)',
				default: 'gemini-3-flash-preview, gemini-3-pro-preview',
				required: true,
			},
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'Gemini',
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'Gemini',
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
		modelsEndpoint: 'openai',
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
				default: '',
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
		modelsEndpoint: 'anthropic',
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
				default: '',
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
		id: 'mistral',
		name: 'Mistral AI',
		modelsEndpoint: 'mistral',
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
				default: '',
				required: true,
			},
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'Mistral',
			},
		],
		buildConfig: answers => ({
			name: answers.providerName || 'Mistral',
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
				default: 'glm-4.7, glm-4.7-flash',
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
				default: 'glm-4.7, glm-4.7-flash',
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
		modelsEndpoint: 'github',
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
				default: '',
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
		id: 'poe',
		name: 'Poe',
		fields: [
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
			{
				name: 'providerName',
				prompt: 'Provider name',
				default: 'Poe',
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
		modelsEndpoint: 'openai-compatible',
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
