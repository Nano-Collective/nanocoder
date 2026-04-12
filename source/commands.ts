import React from 'react';
import {ErrorMessage} from '@/components/message-box';
import type {Command, LazyCommand, Message} from '@/types/index';
import {fuzzyScore} from '@/utils/fuzzy-matching';

class CommandRegistry {
	private commands = new Map<string, Command>();
	private lazyEntries = new Map<string, LazyCommand>();
	// Cached proxy wrappers for lazy commands so `get()` returns a stable
	// reference across calls and handler resolution only happens once.
	private lazyProxies = new Map<string, Command>();

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
		let resolved: Command | null = null;
		const proxy: Command = {
			name: entry.name,
			description: entry.description,
			handler: async (args, messages, metadata) => {
				if (!resolved) {
					resolved = await entry.load();
				}
				return resolved.handler(args, messages, metadata);
			},
		};
		this.lazyProxies.set(entry.name, proxy);
		return proxy;
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
		},
	): Promise<void | string | React.ReactNode> {
		const parts = input.trim().split(/\s+/);
		const commandName = parts[0];
		if (!commandName) {
			return React.createElement(ErrorMessage, {
				key: `error-${Date.now()}`,
				message: 'Invalid command. Type /help for available commands.',
				hideBox: true,
			});
		}

		const args = parts.slice(1);

		const command = this.get(commandName);
		if (!command) {
			return React.createElement(ErrorMessage, {
				key: `error-${Date.now()}`,
				message: `Unknown command: ${commandName}. Type /help for available commands.`,
				hideBox: true,
			});
		}

		return await command.handler(args, messages, metadata);
	}
}

export const commandRegistry = new CommandRegistry();

// Export the class for testing purposes
export {CommandRegistry};
