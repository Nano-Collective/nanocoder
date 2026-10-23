import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse} from 'dotenv';

/**
 * Variables a project `.env` must not set. The `.env` is read before the
 * directory trust check, so any of these coming from the repo would let an
 * untrusted folder trust itself, move the preferences that record trust,
 * or start MCP servers before the user agreed to anything. They are honoured
 * only from the real process environment.
 */
export const PROTECTED_ENV_KEYS: readonly string[] = [
	'NANOCODER_TRUST_DIRECTORY',
	'NANOCODER_CONFIG_DIR',
	'NANOCODER_MCPSERVERS',
	'NANOCODER_MCPSERVERS_FILE',
	'NANOCODER_CI_TRUST_LEVEL',
];

export interface ProjectDotenvResult {
	/** Keys copied into the environment from the `.env`. */
	injected: string[];
	/** Protected keys the `.env` set and that were dropped. */
	ignored: string[];
}

/**
 * Load `<cwd>/.env` into `env` without overriding variables already set
 * (the shell wins). Protected keys are never copied. Parsing is done here
 * rather than with dotenv's `config()` so nothing is printed to stdout.
 */
export function loadProjectDotenv(
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): ProjectDotenvResult {
	const result: ProjectDotenvResult = {injected: [], ignored: []};
	const envPath = join(cwd, '.env');
	if (!existsSync(envPath)) return result;

	let parsed: Record<string, string>;
	try {
		parsed = parse(readFileSync(envPath));
	} catch {
		return result;
	}

	for (const [key, value] of Object.entries(parsed)) {
		if (PROTECTED_ENV_KEYS.includes(key)) {
			result.ignored.push(key);
			continue;
		}
		if (Object.hasOwn(env, key)) continue;
		env[key] = value;
		result.injected.push(key);
	}
	return result;
}

/** One-line warning for protected keys a project `.env` tried to set. */
export function ignoredDotenvWarning(ignored: string[]): string | null {
	if (ignored.length === 0) return null;
	return (
		`Ignoring ${ignored.join(', ')} from the project .env: ` +
		'set ' +
		(ignored.length === 1 ? 'it' : 'them') +
		' in your shell environment instead.'
	);
}
