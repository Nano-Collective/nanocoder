import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {loadPreferences} from '@/config/preferences';
import type {NanocoderPlugin, PluginHooks} from '@/sdk/plugin';
import type {HookContext, HookOutcome} from '@/services/lifecycle-hooks';
import {getProjectRoot} from '@/services/session-cwd';
import type {HookEvent} from '@/types/config';
import {logError} from '@/utils/message-queue';

type PluginEvent = keyof PluginHooks;

const PLUGIN_EVENTS: ReadonlySet<string> = new Set<PluginEvent>([
	'tool.execute.before',
	'tool.execute.after',
	'session.compacting',
	'tui.prompt.append',
	'permission.asked',
]);

const PLUGIN_EVENT_FOR: Partial<Record<HookEvent, PluginEvent>> = {
	'pre-tool-use': 'tool.execute.before',
	'post-tool-use': 'tool.execute.after',
	'pre-compact': 'session.compacting',
	'user-prompt-submit': 'tui.prompt.append',
};

const PLUGIN_HOOK_TIMEOUT_MS = 30_000;

const FAILED = Symbol('failed');

let plugins: NanocoderPlugin[] = [];
let loading: Promise<void> | null = null;

export function loadPlugins(trusted: boolean): Promise<void> {
	if (!trusted) return Promise.resolve();
	// A load that already started is not cancelled by a later false.
	loading ??= importPlugins();
	return loading;
}

/** ACP has no trust prompt. Load only when this project was trusted before. */
export function loadTrustedProjectPlugins(): Promise<void> {
	const root = path.resolve(getProjectRoot());
	let trusted = false;
	try {
		const listed = loadPreferences().trustedDirectories ?? [];
		trusted = listed.some(dir => path.resolve(dir) === root);
	} catch (error) {
		logError(`Could not read directory trust: ${errorMessage(error)}`);
	}
	return loadPlugins(trusted);
}

export function resetPluginsForTests(): void {
	plugins = [];
	loading = null;
}

async function importPlugins(): Promise<void> {
	const dir = path.join(getProjectRoot(), '.nanocoder', 'plugins');
	let files: string[];
	try {
		const entries = await readdir(dir, {withFileTypes: true});
		files = entries
			.filter(entry => entry.isFile() && entry.name.endsWith('.mjs'))
			.map(entry => entry.name)
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			logError(`Could not read plugins in ${dir}: ${errorMessage(error)}`);
		}
		return;
	}

	for (const file of files) {
		let exported: unknown;
		try {
			const mod = (await import(pathToFileURL(path.join(dir, file)).href)) as {
				default?: unknown;
			};
			exported = mod.default;
		} catch (error) {
			logError(`Plugin ${file} failed to load: ${errorMessage(error)}`);
			continue;
		}

		const problem = validatePlugin(exported);
		if (problem) {
			logError(`Plugin ${file} skipped: ${problem}.`);
			continue;
		}
		const plugin = exported as NanocoderPlugin;
		if (plugins.some(loaded => loaded.name === plugin.name)) {
			logError(
				`Plugin ${file} skipped: name "${plugin.name}" is already loaded.`,
			);
			continue;
		}
		plugins.push(plugin);
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function validatePlugin(value: unknown): string | undefined {
	if (!isPlainObject(value)) return 'default export is not a plain object';
	if (value.apiVersion !== 1) return 'apiVersion must be 1';
	if (typeof value.name !== 'string' || value.name === '') {
		return 'name must be a non-empty string';
	}
	if (value.hooks === undefined) return undefined;
	if (!isPlainObject(value.hooks)) return 'hooks must be an object';
	for (const [key, handler] of Object.entries(value.hooks)) {
		if (!PLUGIN_EVENTS.has(key)) return `unknown hook "${key}"`;
		if (typeof handler !== 'function') return `hook "${key}" is not a function`;
	}
	return undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function logBadReturn(plugin: NanocoderPlugin, event: string): void {
	logError(
		`Plugin "${plugin.name}" (${event}) returned an unexpected value, skipping.`,
	);
}

async function invoke(
	plugin: NanocoderPlugin,
	event: PluginEvent,
	ctx: object,
): Promise<unknown> {
	const handler = plugin.hooks?.[event] as (ctx: object) => unknown;
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			Promise.resolve().then(() => handler(ctx)),
			new Promise((_, reject) => {
				timer = setTimeout(
					() =>
						reject(new Error(`timed out after ${PLUGIN_HOOK_TIMEOUT_MS}ms`)),
					PLUGIN_HOOK_TIMEOUT_MS,
				);
				timer.unref();
			}),
		]);
	} catch (error) {
		logError(
			`Plugin "${plugin.name}" (${event}) ${errorMessage(error)}, skipping.`,
		);
		return FAILED;
	} finally {
		clearTimeout(timer);
	}
}

function buildPluginContext(event: PluginEvent, context: HookContext): object {
	switch (event) {
		case 'tool.execute.after':
			return {
				toolName: context.toolName ?? '',
				toolArgs: structuredClone(context.toolArgs ?? {}),
				toolResult: context.toolResult ?? '',
			};
		case 'session.compacting':
			return {messageCount: context.messageCount ?? 0};
		case 'tui.prompt.append':
			return {prompt: context.prompt ?? ''};
		default:
			return {
				toolName: context.toolName ?? '',
				toolArgs: structuredClone(context.toolArgs ?? {}),
			};
	}
}

export async function runPluginHooks(
	event: HookEvent,
	context: HookContext,
): Promise<HookOutcome> {
	const pluginEvent = PLUGIN_EVENT_FOR[event];
	if (!pluginEvent) return {blocked: false, output: ''};
	if (loading) await loading;

	const collected: string[] = [];
	for (const plugin of plugins) {
		if (!plugin.hooks?.[pluginEvent]) continue;
		const result = await invoke(
			plugin,
			pluginEvent,
			buildPluginContext(pluginEvent, context),
		);

		if (result === FAILED || result == null) continue;

		if (pluginEvent === 'tool.execute.before') {
			const block = isPlainObject(result) ? result.block : undefined;
			if (typeof block !== 'string') {
				logBadReturn(plugin, pluginEvent);
				continue;
			}
			const reason = block.trim();
			if (reason === '') continue;
			return {
				blocked: true,
				reason: `Blocked by plugin "${plugin.name}": ${reason}`,
				output: collected.join('\n'),
			};
		}
		if (pluginEvent === 'tool.execute.after') {
			const append = isPlainObject(result) ? result.append : undefined;
			if (typeof append !== 'string') {
				logBadReturn(plugin, pluginEvent);
				continue;
			}
			if (append.trim()) collected.push(append.trim());
		} else if (pluginEvent === 'tui.prompt.append') {
			if (typeof result !== 'string') {
				logBadReturn(plugin, pluginEvent);
				continue;
			}
			if (result.trim()) collected.push(result.trim());
		}
	}

	return {blocked: false, output: collected.join('\n')};
}

export async function consultPluginPermission(
	toolName: string,
	toolArgs: Record<string, unknown>,
): Promise<{decision: 'defer'} | {decision: 'deny'; reason: string}> {
	if (loading) await loading;

	for (const plugin of plugins) {
		if (!plugin.hooks?.['permission.asked']) continue;
		const vote = await invoke(plugin, 'permission.asked', {
			toolName,
			toolArgs: structuredClone(toolArgs),
		});
		if (vote === FAILED) continue;
		if (
			isPlainObject(vote) &&
			vote.decision === 'deny' &&
			typeof vote.reason === 'string' &&
			vote.reason.trim() !== ''
		) {
			return {decision: 'deny', reason: vote.reason.trim()};
		}
		if (!isPlainObject(vote) || vote.decision !== 'defer') {
			logError(
				`Plugin "${plugin.name}" (permission.asked) returned an invalid vote, treating as defer.`,
			);
		}
	}

	return {decision: 'defer'};
}
