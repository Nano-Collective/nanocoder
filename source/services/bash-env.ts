import type {AppConfig} from '@/types/config';

/**
 * Environment variables that hold LLM provider credentials under their
 * usual names. Removed from sandboxed commands only: outside the jail a
 * project's own scripts may legitimately use them (an app that calls the
 * OpenAI API in its integration tests).
 */
const WELL_KNOWN_PROVIDER_KEYS = [
	'ANTHROPIC_API_KEY',
	'AZURE_OPENAI_API_KEY',
	'BRAVE_API_KEY',
	'CEREBRAS_API_KEY',
	'COHERE_API_KEY',
	'DASHSCOPE_API_KEY',
	'DEEPSEEK_API_KEY',
	'FIREWORKS_API_KEY',
	'GEMINI_API_KEY',
	'GOOGLE_API_KEY',
	'GOOGLE_GENERATIVE_AI_API_KEY',
	'GROQ_API_KEY',
	'HF_TOKEN',
	'HUGGINGFACE_API_KEY',
	'MISTRAL_API_KEY',
	'MOONSHOT_API_KEY',
	'OPENAI_API_KEY',
	'OPENROUTER_API_KEY',
	'PERPLEXITY_API_KEY',
	'TOGETHER_API_KEY',
	'XAI_API_KEY',
];

// Shorter values are placeholders ("ollama", "none"), not credentials, and
// matching them could strip an unrelated variable.
const MIN_SECRET_LENGTH = 16;

/** The credentials nanocoder itself was configured with, after `$VAR` expansion. */
function configuredSecrets(config: AppConfig): Set<string> {
	const secrets = new Set<string>();
	const add = (value: string | undefined) => {
		const trimmed = value?.trim();
		if (trimmed && trimmed.length >= MIN_SECRET_LENGTH) secrets.add(trimmed);
	};
	for (const provider of config.providers ?? []) add(provider.apiKey);
	add(config.nanocoderTools?.webSearch?.apiKey);
	return secrets;
}

/**
 * The environment for an `execute_bash` / `!command` child. nanocoder's own
 * provider credentials are removed: any variable whose value is one of the
 * configured API keys (which is what an `apiKey: "$VAR"` reference expands
 * from), and NANOCODER_PROVIDERS, which carries whole provider entries. In
 * sandbox mode the well-known provider key variables go too.
 */
export function bashChildEnv(
	env: NodeJS.ProcessEnv,
	config: AppConfig,
	sandbox: boolean,
): NodeJS.ProcessEnv {
	const secrets = configuredSecrets(config);
	const drop = new Set(['NANOCODER_PROVIDERS']);
	if (sandbox) for (const name of WELL_KNOWN_PROVIDER_KEYS) drop.add(name);
	const result: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(env)) {
		if (drop.has(name)) continue;
		if (value !== undefined && secrets.has(value.trim())) continue;
		result[name] = value;
	}
	return result;
}
