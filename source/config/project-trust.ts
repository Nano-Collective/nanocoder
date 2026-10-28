import {createHash} from 'node:crypto';
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	type Stats,
	statSync,
} from 'node:fs';
import path from 'node:path';
import {HOOK_EVENTS, type HookEvent} from '@/types/config';
import {parseYamlObject, splitFrontmatter} from '@/utils/frontmatter';

/**
 * Bump when `describeProjectTrust` changes what it fingerprints. A trust entry
 * from another version holds a fingerprint that can't be compared with this
 * one, so it reads as needing re-approval rather than as a changed folder.
 */
export const TRUST_FINGERPRINT_VERSION = 1;

export interface ProjectTrustSurface {
	plugins: number;
	sessionStartHooks: number;
	otherHooks: number;
	mcpServers: number;
	formatters: number;
	lspServers: number;
	customTools: number;
	subscribedSkills: number;
	subscribedAgents: number;
	subscribedCommands: number;
	/** True when the folder has a `.env`, which is loaded into the environment. */
	envFile: boolean;
	/** `agents.config.json` settings that skip or relax confirmations. */
	permissionSettings: number;
	/** Project providers with a `baseUrl`, where prompts and code are sent. */
	providerEndpoints: number;
	fingerprint: string;
	/** Null when this folder will not run any of the above. */
	summary: string | null;
}

/**
 * What this folder will run once it is trusted: in-process plugins, hooks,
 * formatters, LSP servers, project MCP servers, custom tools, and the skills, agents,
 * and commands the daemon triggers on its own. Also the `.env` it loads, the
 * project settings that relax confirmations (`alwaysAllow`, `defaultMode`,
 * `sandbox`, `verify.trustLevel`), and project provider `baseUrl`s. The
 * fingerprint covers those files, so a later edit is visible even when the
 * counts stay the same. Each part adds a line only when present, so a folder
 * without them keeps the fingerprint it had before they were covered.
 */
export function describeProjectTrust(directory: string): ProjectTrustSurface {
	const root = path.resolve(directory);
	const lines: string[] = [];

	const plugins = listPlugins(root, lines);
	const config = readProjectConfig(root, lines);
	const hooks = listHooks(config, lines);
	const formatters = listFormatters(config, lines);
	const lspServers = listLspServers(config, lines);
	const mcpServers = listMcpServers(root, lines);
	const customTools = listCustomTools(root, lines);
	const subscribedSkills = listSubscribedSkills(root, lines);
	const subscribedAgents = listSubscribedFiles(root, 'agents', false, lines);
	const subscribedCommands = listSubscribedFiles(root, 'commands', true, lines);
	const envFile = listEnvFile(root, lines);
	const permissionSettings = listPermissionSettings(config, lines);
	const providerEndpoints = listProviderEndpoints(config, lines);

	const parts = [
		countLabel(plugins, 'plugin', 'plugins'),
		countLabel(hooks.sessionStart, 'session-start hook', 'session-start hooks'),
		countLabel(hooks.other, 'other hook', 'other hooks'),
		countLabel(mcpServers, 'MCP server', 'MCP servers'),
		countLabel(formatters, 'formatter', 'formatters'),
		countLabel(lspServers, 'LSP server', 'LSP servers'),
		countLabel(customTools, 'custom tool', 'custom tools'),
		countLabel(subscribedSkills, 'subscribed skill', 'subscribed skills'),
		countLabel(subscribedAgents, 'subscribed agent', 'subscribed agents'),
		countLabel(subscribedCommands, 'subscribed command', 'subscribed commands'),
		envFile ? 'a .env file' : null,
		countLabel(permissionSettings, 'permission setting', 'permission settings'),
		countLabel(providerEndpoints, 'provider endpoint', 'provider endpoints'),
	].filter((part): part is string => part !== null);

	return {
		plugins,
		sessionStartHooks: hooks.sessionStart,
		otherHooks: hooks.other,
		mcpServers,
		formatters,
		lspServers,
		customTools,
		subscribedSkills,
		subscribedAgents,
		subscribedCommands,
		envFile,
		permissionSettings,
		providerEndpoints,
		fingerprint: createHash('sha256').update(lines.join('\n')).digest('hex'),
		summary:
			parts.length > 0 ? `This folder contains: ${parts.join(', ')}.` : null,
	};
}

function countLabel(
	count: number,
	singular: string,
	plural: string,
): string | null {
	if (count === 0) return null;
	return `${count} ${count === 1 ? singular : plural}`;
}

function listPlugins(root: string, lines: string[]): number {
	const dir = path.join(root, '.nanocoder', 'plugins');
	let names: string[] = [];
	try {
		names = readdirSync(dir, {withFileTypes: true})
			.filter(entry => entry.isFile() && entry.name.endsWith('.mjs'))
			.map(entry => entry.name)
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			lines.push(`plugins unreadable ${hashText(String(error))}`);
		}
		return 0;
	}

	for (const name of names) {
		lines.push(`plugin ${name} ${hashFile(path.join(dir, name))}`);
	}
	return names.length;
}

function listHooks(
	config: ProjectConfig | undefined,
	lines: string[],
): {sessionStart: number; other: number} {
	const hooks = config?.nanocoder?.hooks;
	if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
		return {sessionStart: 0, other: 0};
	}

	let sessionStart = 0;
	let other = 0;
	for (const event of HOOK_EVENTS) {
		const entries = hookEntries(hooks[event]);
		// The whole entry: matchTools, matchFiles, and timeout change what runs.
		for (const entry of entries) {
			lines.push(`hook ${event} ${JSON.stringify(entry)}`);
		}
		if (event === 'session-start') sessionStart += entries.length;
		else other += entries.length;
	}
	return {sessionStart, other};
}

function listFormatters(
	config: ProjectConfig | undefined,
	lines: string[],
): number {
	const formatters = config?.nanocoder?.formatters;
	if (!Array.isArray(formatters)) return 0;

	let count = 0;
	for (const entry of formatters) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
		const command = (entry as {command?: unknown}).command;
		if (typeof command !== 'string' || command.trim() === '') continue;
		const match = (entry as {match?: unknown}).match;
		const globs = Array.isArray(match)
			? match.filter((item): item is string => typeof item === 'string')
			: typeof match === 'string'
				? [match]
				: [];
		if (globs.length === 0) continue;
		// The whole entry, so `prettier` + `--write *.ts` and
		// `prettier --write` + `*.ts` can't produce the same line.
		lines.push(`formatter ${JSON.stringify(entry)}`);
		count++;
	}
	return count;
}

/**
 * `nanocoder.lspServers` entries start a `command` when Nanocoder launches.
 * Counts the entries the config loader keeps (a name, a command, and a
 * languages list) and fingerprints each whole, so an `args` or `env` edit
 * is a different program.
 */
function listLspServers(
	config: ProjectConfig | undefined,
	lines: string[],
): number {
	const servers = config?.nanocoder?.lspServers;
	if (!Array.isArray(servers)) return 0;

	let count = 0;
	for (const entry of servers) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
		const {name, command, languages} = entry as Record<string, unknown>;
		if (typeof name !== 'string' || typeof command !== 'string') continue;
		if (command.trim() === '' || !Array.isArray(languages)) continue;
		lines.push(`lsp ${JSON.stringify(entry)}`);
		count++;
	}
	return count;
}

/** The project `.env` is loaded into the environment at startup. */
function listEnvFile(root: string, lines: string[]): boolean {
	const file = path.join(root, '.env');
	if (!statOrNull(file)?.isFile()) return false;
	lines.push(`env ${hashFile(file)}`);
	return true;
}

/**
 * Project settings that run tools without asking or loosen how they run.
 * Each is fingerprinted by value, so turning one on later is a change.
 */
function listPermissionSettings(
	config: ProjectConfig | undefined,
	lines: string[],
): number {
	const nanocoder = config?.nanocoder;
	if (!nanocoder || typeof nanocoder !== 'object') return 0;

	const settings: [string, unknown][] = [
		['alwaysAllow', nanocoder.alwaysAllow],
		['defaultMode', nanocoder.defaultMode],
		['sandbox', nanocoder.sandbox],
		[
			'verify.trustLevel',
			nanocoder.verify && typeof nanocoder.verify === 'object'
				? (nanocoder.verify as {trustLevel?: unknown}).trustLevel
				: undefined,
		],
	];
	let count = 0;
	for (const [name, value] of settings) {
		if (value === undefined) continue;
		lines.push(`setting ${name} ${JSON.stringify(value)}`);
		count++;
	}
	return count;
}

/**
 * Project providers with a `baseUrl`, read the way the provider loader reads
 * them (`nanocoder.providers`, else top-level `providers`). A swapped URL
 * sends the conversation somewhere else.
 */
function listProviderEndpoints(
	config: ProjectConfig | undefined,
	lines: string[],
): number {
	const providers = Array.isArray(config?.nanocoder?.providers)
		? config.nanocoder.providers
		: Array.isArray(config?.providers)
			? config.providers
			: [];

	let count = 0;
	for (const entry of providers) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
		const {name, baseUrl} = entry as Record<string, unknown>;
		if (baseUrl === undefined) continue;
		lines.push(
			`provider ${JSON.stringify(name)} baseUrl ${JSON.stringify(baseUrl)}`,
		);
		count++;
	}
	return count;
}

function listMcpServers(root: string, lines: string[]): number {
	const file = path.join(root, '.mcp.json');
	if (!existsSync(file)) return 0;
	let raw: string;
	try {
		raw = readFileSync(file, 'utf8');
	} catch (error) {
		lines.push(`unreadable .mcp.json ${hashText(String(error))}`);
		return 0;
	}
	// The whole file, not just command and url. An args or env edit is still
	// a different program.
	lines.push(`mcp ${hashText(raw)}`);

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		return 0;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 0;
	const servers = (parsed as {mcpServers?: unknown}).mcpServers;
	if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
		return 0;
	}
	return Object.keys(servers).length;
}

function listCustomTools(root: string, lines: string[]): number {
	const skillsDir = path.join(root, '.nanocoder', 'skills');
	const dirs = [
		path.join(root, '.nanocoder', 'tools'),
		...listDirs(skillsDir).map(name => path.join(skillsDir, name, 'tools')),
	];
	let count = 0;
	for (const dir of dirs) {
		for (const name of listFiles(dir).filter(file => file.endsWith('.md'))) {
			const file = path.join(dir, name);
			lines.push(`tool ${path.relative(root, file)} ${hashFile(file)}`);
			count++;
		}
	}
	return count;
}

/**
 * Skill bundles with a `subscribe:` trigger, in `skill.yaml` or a member's
 * frontmatter. The daemon runs those without asking, so the whole bundle
 * is fingerprinted.
 */
function listSubscribedSkills(root: string, lines: string[]): number {
	const skillsDir = path.join(root, '.nanocoder', 'skills');
	let count = 0;
	for (const name of listDirs(skillsDir)) {
		const bundle = path.join(skillsDir, name);
		const files = listFiles(bundle, true).map(file => path.join(bundle, file));
		const contents = files.map(file => {
			try {
				return readFileSync(file, 'utf8');
			} catch (error) {
				return String(error);
			}
		});
		if (!files.some((file, i) => declaresSubscribe(file, contents[i] ?? ''))) {
			continue;
		}
		lines.push(`skill ${name} ${hashText(contents.join('\0'))}`);
		count++;
	}
	return count;
}

/**
 * Flat `.nanocoder/agents/*.md` and `.nanocoder/commands/**\/*.md` files with
 * a `subscribe:` trigger. Walked the way their loaders walk them: agents
 * one level deep, commands recursively.
 */
function listSubscribedFiles(
	root: string,
	kind: 'agents' | 'commands',
	recursive: boolean,
	lines: string[],
): number {
	const dir = path.join(root, '.nanocoder', kind);
	let count = 0;
	for (const name of listFiles(dir, recursive).filter(f => f.endsWith('.md'))) {
		const file = path.join(dir, name);
		let text: string;
		try {
			text = readFileSync(file, 'utf8');
		} catch {
			continue;
		}
		if (!declaresSubscribe(file, text)) continue;
		lines.push(`${kind} ${name} ${hashText(text)}`);
		count++;
	}
	return count;
}

/**
 * Same parse the loaders use, so a quoted or escaped key can't hide a
 * trigger from the fingerprint while the loader still registers it.
 */
function declaresSubscribe(file: string, text: string): boolean {
	const yaml = file.endsWith('.md') ? splitFrontmatter(text).frontmatter : text;
	return parseYamlObject(yaml)?.subscribe !== undefined;
}

// The listings follow symlinks, as the tool, command, and skill loaders do.

function listDirs(dir: string): string[] {
	return listNames(dir).filter(name =>
		statOrNull(path.join(dir, name))?.isDirectory(),
	);
}

function listFiles(
	dir: string,
	recursive = false,
	seen = new Set<string>(),
): string[] {
	try {
		const real = realpathSync(dir);
		if (seen.has(real)) return [];
		seen.add(real);
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const name of listNames(dir)) {
		const stat = statOrNull(path.join(dir, name));
		if (stat?.isFile()) {
			files.push(name);
		} else if (recursive && stat?.isDirectory()) {
			for (const file of listFiles(path.join(dir, name), true, seen)) {
				files.push(path.join(name, file));
			}
		}
	}
	return files;
}

function listNames(dir: string): string[] {
	try {
		return readdirSync(dir).sort();
	} catch {
		return [];
	}
}

function statOrNull(file: string): Stats | null {
	try {
		return statSync(file);
	} catch {
		return null;
	}
}

function hookEntries(entries: unknown): object[] {
	if (!Array.isArray(entries)) return [];
	return entries.filter((entry): entry is object => {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			return false;
		}
		const command = (entry as {command?: unknown}).command;
		return typeof command === 'string' && command.trim() !== '';
	});
}

interface ProjectConfig {
	nanocoder?: {
		hooks?: Partial<Record<HookEvent, unknown>>;
		formatters?: unknown[];
		lspServers?: unknown[];
		alwaysAllow?: unknown;
		defaultMode?: unknown;
		sandbox?: unknown;
		verify?: unknown;
		providers?: unknown;
	};
	providers?: unknown;
}

function readProjectConfig(
	root: string,
	lines: string[],
): ProjectConfig | undefined {
	const parsed = readJsonFile(path.join(root, 'agents.config.json'), lines);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return undefined;
	}
	return parsed as ProjectConfig;
}

function readJsonFile(file: string, lines: string[]): unknown {
	if (!existsSync(file)) return undefined;
	let raw: string;
	try {
		raw = readFileSync(file, 'utf8');
	} catch (error) {
		lines.push(`unreadable ${path.basename(file)} ${hashText(String(error))}`);
		return undefined;
	}
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		lines.push(`invalid ${path.basename(file)} ${hashText(raw)}`);
		return undefined;
	}
}

function hashFile(file: string): string {
	try {
		return hashText(readFileSync(file));
	} catch (error) {
		return hashText(String(error));
	}
}

function hashText(value: string | Buffer): string {
	return createHash('sha256').update(value).digest('hex');
}
