import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {HOOK_EVENTS, type HookEvent} from '@/types/config';

export interface ProjectTrustSurface {
	plugins: number;
	sessionStartHooks: number;
	otherHooks: number;
	mcpServers: number;
	formatters: number;
	fingerprint: string;
	/** Null when this folder will not run any of the above. */
	summary: string | null;
}

/**
 * What this folder will run once it is trusted: in-process plugins, hooks,
 * formatters, and project MCP servers. The fingerprint covers those files,
 * so a later edit is visible even when the counts stay the same.
 */
export function describeProjectTrust(directory: string): ProjectTrustSurface {
	const root = path.resolve(directory);
	const lines: string[] = [];

	const plugins = listPlugins(root, lines);
	const config = readProjectConfig(root, lines);
	const hooks = listHooks(config, lines);
	const formatters = listFormatters(config, lines);
	const mcpServers = listMcpServers(root, lines);

	const parts = [
		countLabel(plugins, 'plugin', 'plugins'),
		countLabel(hooks.sessionStart, 'session-start hook', 'session-start hooks'),
		countLabel(hooks.other, 'other hook', 'other hooks'),
		countLabel(mcpServers, 'MCP server', 'MCP servers'),
		countLabel(formatters, 'formatter', 'formatters'),
	].filter((part): part is string => part !== null);

	return {
		plugins,
		sessionStartHooks: hooks.sessionStart,
		otherHooks: hooks.other,
		mcpServers,
		formatters,
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
		const commands = hookCommands(hooks[event]);
		for (const command of commands) {
			lines.push(`hook ${event} ${command}`);
		}
		if (event === 'session-start') sessionStart += commands.length;
		else other += commands.length;
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
		lines.push(`formatter ${command} ${globs.join(',')}`);
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

function hookCommands(entries: unknown): string[] {
	if (!Array.isArray(entries)) return [];
	const commands: string[] = [];
	for (const entry of entries) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
		const command = (entry as {command?: unknown}).command;
		if (typeof command === 'string' && command.trim() !== '') {
			commands.push(command);
		}
	}
	return commands;
}

interface ProjectConfig {
	nanocoder?: {
		hooks?: Partial<Record<HookEvent, unknown>>;
		formatters?: unknown[];
	};
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
