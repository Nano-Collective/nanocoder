import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse} from 'dotenv';

/*
 * A project `.env` is read before the directory trust check, so whatever it
 * sets is in effect before the user has agreed to anything in the folder: it
 * could let an untrusted folder trust itself, move the preferences that
 * record trust, start MCP servers, or inject code into every child process.
 * An enumerated list of the dangerous keys missed each one nobody had thought
 * of yet (NANOCODER_PROVIDERS, NANOCODER_DATA_DIR, NODE_OPTIONS, ...), so the
 * rules here are broad on purpose:
 *
 * - every `NANOCODER_*` variable is honoured only from the real process
 *   environment, apart from a short allowlist of tuning knobs that cannot
 *   move trust, config, data or code. A new NANOCODER_* variable is
 *   protected until someone decides otherwise;
 * - variables that change how child processes (MCP servers, hooks, bash,
 *   git, formatters, LSP servers) start, where config lives, or where
 *   network traffic goes are protected by name or prefix.
 *
 * Ordinary keys (API keys, app settings) still load as before.
 */

/** `NANOCODER_*` variables a project `.env` may still set. */
const ALLOWED_NANOCODER_KEYS: ReadonlySet<string> = new Set([
	'NANOCODER_CONTEXT_LIMIT',
	'NANOCODER_LOG_LEVEL',
	'NANOCODER_MAX_TURNS',
	'NANOCODER_NO_UPDATE_CHECK',
]);

/** Protected by exact name, compared case-insensitively. */
const PROTECTED_KEY_NAMES: ReadonlySet<string> = new Set([
	// Shells and language runtimes that run code named by these at start-up.
	'NODE_OPTIONS',
	'NODE_PATH',
	'BASH_ENV',
	'ENV',
	'ZDOTDIR',
	'PROMPT_COMMAND',
	'SHELLOPTS',
	'BASHOPTS',
	'PS4',
	'IFS',
	'PYTHONPATH',
	'PYTHONSTARTUP',
	'PERL5OPT',
	'PERL5LIB',
	'RUBYOPT',
	'RUBYLIB',
	// What runs when a command, shell or editor is invoked.
	'PATH',
	'SHELL',
	'EDITOR',
	'VISUAL',
	'PAGER',
	// Where config, trust and data are read from and written to.
	'HOME',
	'APPDATA',
	'LOCALAPPDATA',
	'USERPROFILE',
	// TLS trust, and where network traffic (API keys included) goes.
	'NODE_TLS_REJECT_UNAUTHORIZED',
	'NODE_EXTRA_CA_CERTS',
	'SSL_CERT_FILE',
	'SSL_CERT_DIR',
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'ALL_PROXY',
	'NO_PROXY',
]);

/**
 * Protected by prefix, compared case-insensitively: git config, SSH and
 * askpass commands (`GIT_CONFIG_*`, `GIT_SSH_COMMAND`, ...), the dynamic
 * linker (`LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`), the XDG base directories,
 * and npm/pnpm config (which can pick the shell package scripts run in).
 */
const PROTECTED_KEY_PREFIXES: readonly string[] = [
	'GIT_',
	'LD_',
	'DYLD_',
	'XDG_',
	'NPM_CONFIG_',
	'PNPM_CONFIG_',
];

/**
 * True when a project `.env` must not set `key`. Such keys are honoured only
 * from the real process environment.
 */
export function isProtectedEnvKey(key: string): boolean {
	const upper = key.toUpperCase();
	if (upper.startsWith('NANOCODER_')) {
		return !ALLOWED_NANOCODER_KEYS.has(upper);
	}
	if (PROTECTED_KEY_NAMES.has(upper)) return true;
	return PROTECTED_KEY_PREFIXES.some(prefix => upper.startsWith(prefix));
}

export interface ProjectDotenvResult {
	/** Keys copied into the environment from the `.env`. */
	injected: string[];
	/** Protected keys the `.env` set, not set in the shell, and dropped. */
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
		// The shell wins for every key, so a value already set there was never
		// going to come from the .env: only a protected key the shell leaves
		// unset is actually being dropped, and only that is worth a warning.
		if (Object.hasOwn(env, key)) continue;
		if (isProtectedEnvKey(key)) {
			result.ignored.push(key);
			continue;
		}
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
