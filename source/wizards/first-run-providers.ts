import {lstatSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {Agent, fetch as fetchDirect} from 'undici';
import {getConfigPath} from '@/config/paths';
import type {ProviderConfig} from '@/types/config';
import {atomicWriteJson, publishFileNoClobber} from '@/utils/fs/atomic-write';
import {withExclusiveLock} from '@/utils/fs/exclusive-file-lock';
import {stripUtf8Bom} from '@/utils/strip-utf8-bom';
import type {ConfigLocation} from './steps/location-step';
import {
	PROVIDER_TEMPLATES,
	type ProviderTemplate,
} from './templates/provider-templates';
import {type ApiCompatibility, fetchModels} from './utils/fetch-models';
import {buildProviderConfigObject} from './validation';

const CONFIG_FILE = 'agents.config.json';
const PROBE_TIMEOUT_MS = 500;
const MAX_PROBE_RESPONSE_BYTES = 1024 * 1024;

const LOCAL_TEMPLATES = [
	{id: 'ollama', api: 'ollama'},
	{id: 'lmstudio', api: 'openai-compatible'},
	{id: 'llama-cpp', api: 'openai-compatible'},
] as const satisfies readonly {id: string; api: ApiCompatibility}[];

const HOSTED_KEY_VARS = {
	openrouter: 'OPENROUTER_API_KEY',
	openai: 'OPENAI_API_KEY',
	anthropic: 'ANTHROPIC_API_KEY',
	gemini: 'GEMINI_API_KEY',
	groq: 'GROQ_API_KEY',
} as const;

export interface DetectedProvider {
	config: ProviderConfig;
	keyVariable?: string;
}

function configFileState(path: string): 'missing' | 'empty' | 'existing' {
	try {
		if (!lstatSync(path).isFile()) return 'existing';
		const config: unknown = JSON.parse(
			stripUtf8Bom(readFileSync(path, 'utf8')),
		);
		return config !== null &&
			typeof config === 'object' &&
			!Array.isArray(config) &&
			Object.keys(config).length === 0
			? 'empty'
			: 'existing';
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'ENOENT'
			? 'missing'
			: 'existing';
	}
}

function setupPaths(
	projectDir: string,
): Partial<Record<ConfigLocation, string>> {
	const global = resolve(getConfigPath(), CONFIG_FILE);
	const project = resolve(projectDir, CONFIG_FILE);
	return process.env.NANOCODER_CONFIG_DIR || project === global
		? {global}
		: {project, global};
}

export function getFirstRunSetupPaths(
	projectDir: string,
): Partial<Record<ConfigLocation, string>> | undefined {
	const paths = setupPaths(projectDir);
	// Startup creates an empty global placeholder. A nonempty, unreadable or
	// malformed config belongs in the regular wizard.
	return Object.values(paths).every(
		path => configFileState(path) !== 'existing',
	)
		? paths
		: undefined;
}

function buildTemplate(
	template: ProviderTemplate,
	overrides: Record<string, string> = {},
): ProviderConfig {
	const defaults = Object.fromEntries(
		template.fields.map(field => [field.name, field.default ?? '']),
	);
	return template.buildConfig({...defaults, ...overrides});
}

function detectHostedProviders(env: NodeJS.ProcessEnv): DetectedProvider[] {
	return Object.entries(HOSTED_KEY_VARS).flatMap(([id, keyVariable]) => {
		if (!env[keyVariable]?.trim()) return [];
		const template = PROVIDER_TEMPLATES.find(template => template.id === id);
		if (!template) return [];
		const config = buildTemplate(template, {apiKey: `\${${keyVariable}}`});
		return config.models.length ? [{config, keyVariable}] : [];
	});
}

export async function detectFirstRunProviders(
	env: NodeJS.ProcessEnv,
	signal: AbortSignal,
	fetchProviderModels: typeof fetchModels = fetchModels,
): Promise<DetectedProvider[]> {
	const hosted = detectHostedProviders(env);
	// Use a direct dispatcher even if the user has configured a global proxy.
	// Literal loopback addresses and disabled redirects keep discovery local.
	const dispatcher = new Agent({maxResponseSize: MAX_PROBE_RESPONSE_BYTES});
	try {
		const local = await Promise.all(
			LOCAL_TEMPLATES.map(async ({id, api}) => {
				const template = PROVIDER_TEMPLATES.find(
					template => template.id === id,
				);
				if (!template) return undefined;
				const config = buildTemplate(template);
				if (!config.baseUrl) return undefined;
				const url = new URL(config.baseUrl);
				for (const hostname of ['127.0.0.1', '[::1]']) {
					if (signal.aborted) return undefined;
					url.hostname = hostname;
					const baseUrl = url.toString();
					const response = await fetchProviderModels(baseUrl, api, undefined, {
						timeoutMs: PROBE_TIMEOUT_MS,
						signal,
						request: (endpoint, options) =>
							fetchDirect(endpoint, {
								...options,
								dispatcher,
								redirect: 'error',
							}),
					});
					if (!response.success) continue;
					const models = [...new Set(response.models.map(model => model.id))];
					if (!models.length) continue;
					return {
						config: {
							...config,
							// Multiple OpenAI-compatible servers use 8080.
							name: id === 'llama-cpp' ? 'Local server (8080)' : config.name,
							baseUrl,
							// The config loader expands environment references in model IDs too.
							models: models.map(model => model.replaceAll('$', () => '$$')),
						},
					};
				}
				return undefined;
			}),
		);
		return [...local.filter(candidate => candidate !== undefined), ...hosted];
	} finally {
		await dispatcher.destroy();
	}
}

export async function saveDetectedProviders(
	projectDir: string,
	location: ConfigLocation,
	providers: DetectedProvider[],
): Promise<string> {
	const path = setupPaths(projectDir)[location];
	if (!path || !providers.length)
		throw new Error(
			'Choose an available configuration location and at least one provider.',
		);
	mkdirSync(dirname(path), {recursive: true});
	return withExclusiveLock(`${path}.setup.lock`, async () => {
		if (!getFirstRunSetupPaths(projectDir)) {
			throw new Error(
				'A configuration already exists. Open manual setup to edit it.',
			);
		}
		const config = buildProviderConfigObject({
			providers: providers.map(provider => provider.config),
		});
		if (configFileState(path) === 'empty') {
			atomicWriteJson(path, config);
		} else if (
			!publishFileNoClobber(path, `${JSON.stringify(config, null, 2)}\n`)
		) {
			throw new Error(
				'A configuration was created during setup. Open manual setup to edit it.',
			);
		}
		return path;
	});
}
