import React from 'react';
import {findCommandAlias} from '@/commands/aliases';
import {
	type AnyCommand,
	type Command,
	isStatefulCommand,
	type LazyCommand,
	type Message,
} from '@/types/index';
import {fuzzyScore} from '@/utils/fuzzy-matching';
import {errorMsg} from '@/utils/message-factory';

class CommandRegistry {
	private commands = new Map<string, Command>();
	private lazyEntries = new Map<string, LazyCommand>();
	// Cached proxy wrappers for lazy commands so `get()` returns a stable
	// reference across calls.
	private lazyProxies = new Map<string, Command>();
	// Lazy command modules already imported, so each loads only once.
	private loaded = new Map<string, AnyCommand>();

	register(command: Command | Command[]): void {
		if (Array.isArray(command)) {
			command.forEach(cmd => this.register(cmd));
			return;
		}
		this.commands.set(command.name, command);
	}

	/**
	 * Register one or more lazy command entries. The command module is not
	 * loaded until the command is actually executed.
	 */
	registerLazy(entry: LazyCommand | LazyCommand[]): void {
		if (Array.isArray(entry)) {
			entry.forEach(e => this.registerLazy(e));
			return;
		}
		this.lazyEntries.set(entry.name, entry);
	}

	private proxyForLazy(entry: LazyCommand): Command {
		const cached = this.lazyProxies.get(entry.name);
		if (cached) return cached;
		const proxy: Command = {
			name: entry.name,
			description: entry.description,
			progressLabel: entry.progressLabel,
			echoInvocation: entry.echoInvocation,
			hidden: entry.hidden,
			handler: async (args, messages, metadata) => {
				const resolved = await this.loadLazy(entry);
				if (isStatefulCommand(resolved)) {
					throw new Error(
						`/${entry.name} needs app state; run it through the command dispatcher.`,
					);
				}
				return resolved.handler(args, messages, metadata);
			},
		};
		this.lazyProxies.set(entry.name, proxy);
		return proxy;
	}

	private async loadLazy(entry: LazyCommand): Promise<AnyCommand> {
		const cached = this.loaded.get(entry.name);
		if (cached) return cached;
		const command = await entry.load();
		this.loaded.set(entry.name, command);
		return command;
	}

	/**
	 * The command module itself, importing it if it is lazy. Unlike `get()`,
	 * which returns a metadata proxy without loading anything, this tells a
	 * stateful command apart from one that just returns output.
	 */
	async load(name: string): Promise<AnyCommand | undefined> {
		const eager = this.commands.get(name);
		if (eager) return eager;
		const lazy = this.lazyEntries.get(name);
		return lazy ? this.loadLazy(lazy) : undefined;
	}

	get(name: string): Command | undefined {
		const eager = this.commands.get(name);
		if (eager) return eager;
		const lazy = this.lazyEntries.get(name);
		if (lazy) return this.proxyForLazy(lazy);
		return undefined;
	}

	getAll(): Command[] {
		const result: Command[] = Array.from(this.commands.values());
		for (const entry of this.lazyEntries.values()) {
			result.push(this.proxyForLazy(entry));
		}
		return result;
	}

	getCompletions(prefix: string): string[] {
		const commandNames = [...this.commands.keys(), ...this.lazyEntries.keys()];

		// Old command names (see `aliases.ts`) are never offered while typing,
		// but one typed out in full completes to itself. Without that, Enter
		// on a fully typed `/quit` would accept whatever fuzzy match the menu
		// had highlighted instead of submitting it.
		const alias = findCommandAlias(prefix);
		if (alias && !commandNames.includes(alias.name)) {
			commandNames.push(alias.name);
		}

		// No prefix: return all commands alphabetically
		if (!prefix) {
			return commandNames.sort((a, b) => a.localeCompare(b));
		}

		// Use fuzzy matching with scoring
		const scoredCommands = commandNames
			.map(name => ({
				name,
				score: fuzzyScore(name, prefix),
			}))
			.filter(cmd => cmd.score > 0) // Only include matches
			.sort((a, b) => {
				// Sort by score (descending)
				if (b.score !== a.score) {
					return b.score - a.score;
				}
				// If scores are equal, sort alphabetically
				return a.name.localeCompare(b.name);
			});

		return scoredCommands.map(cmd => cmd.name);
	}

	async execute(
		input: string,
		messages: Message[],
		metadata: {
			provider: string;
			model: string;
			tokens: number;
			getMessageTokens: (message: Message) => number;
			client?: import('@/types/core').LLMClient | null;
			tune?: import('@/types/config').TuneConfig;
			developmentMode?: import('@/types/core').DevelopmentMode;
			lastApiUsage?: import('@/types/core').ApiUsageSnapshot | null;
			apiCallHistory?: import('@/types/core').ApiCallRecord[];
			sessionId?: string;
		},
	): Promise<void | string | React.ReactNode> {
		const parts = input.trim().split(/\s+/);
		const commandName = parts[0];
		if (!commandName) {
			return errorMsg(
				'Invalid command. Type /help for available commands.',
				'error',
			);
		}

		const args = parts.slice(1);

		const command = this.get(commandName);
		if (!command) {
			return errorMsg(
				`Unknown command: ${commandName}. Type /help for available commands.`,
				'error',
			);
		}

		return await command.handler(args, messages, metadata);
	}
}

export const commandRegistry = new CommandRegistry();

// Export the class for testing purposes
export {CommandRegistry};
