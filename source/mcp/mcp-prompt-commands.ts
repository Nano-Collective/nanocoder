import type {Command, LazyCommand} from '@/types/commands';
import type {MCPPrompt} from '@/types/mcp';
import {getLogger} from '@/utils/logging';
import {infoMsg} from '@/utils/message-factory';
import type {MCPClient} from './mcp-client.js';

const logger = getLogger();

/**
 * Generate lazy command entries for MCP prompts
 * These commands will be registered in the command registry alongside built-in commands
 */
export function generateMCPPromptCommands(mcpClient: MCPClient): LazyCommand[] {
	const prompts = mcpClient.getAllPrompts();
	const commands: LazyCommand[] = [];

	for (const prompt of prompts) {
		// Create a namespaced command name: mcp:<server>:<prompt>
		// This avoids conflicts with built-in commands
		const commandName = `mcp:${prompt.serverName}:${prompt.name}`;

		const lazyCommand: LazyCommand = {
			name: commandName,
			description: prompt.description
				? `[MCP:${prompt.serverName}] ${prompt.description}`
				: `MCP prompt from ${prompt.serverName}`,
			load: async () => {
				return createMCPPromptCommand(mcpClient, prompt);
			},
		};

		commands.push(lazyCommand);
	}

	logger.debug('Generated MCP prompt commands', {
		count: commands.length,
		commands: commands.map(c => c.name),
	});

	return commands;
}

/**
 * Create an executable command for an MCP prompt
 */
function createMCPPromptCommand(
	mcpClient: MCPClient,
	prompt: MCPPrompt,
): Command {
	return {
		name: `mcp:${prompt.serverName}:${prompt.name}`,
		description: prompt.description
			? `[MCP:${prompt.serverName}] ${prompt.description}`
			: `MCP prompt from ${prompt.serverName}`,
		handler: async (args, _messages, _metadata) => {
			try {
				// Parse arguments for the prompt
				// MCP prompts can have named arguments, so we support key=value syntax
				const promptArgs: Record<string, string> = {};

				for (const arg of args) {
					const match = arg.match(/^([^=]+)=(.+)$/);
					if (match) {
						const [, key, value] = match;
						promptArgs[key] = value;
					} else {
						// If no key=value format, treat as positional argument
						// Use the first required argument from the prompt schema
						const requiredArg = prompt.arguments?.find(a => a.required);
						if (requiredArg) {
							promptArgs[requiredArg.name] = arg;
						}
					}
				}

				logger.info('Executing MCP prompt command', {
					promptName: prompt.name,
					serverName: prompt.serverName,
					args: promptArgs,
				});

				// Get the prompt from the MCP server
				const result = await mcpClient.getPrompt(prompt.name, promptArgs);

				// Format the result for display
				let output = '';
				if (result.description) {
					output += `${result.description}\n\n`;
				}

				// Display the messages from the prompt
				for (const message of result.messages) {
					output += `**${message.role}**: ${message.content.text || message.content.data || '(no text content)'}\n\n`;
				}

				return infoMsg(output.trim() || 'Prompt executed successfully.');
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				logger.error('MCP prompt command failed', {
					promptName: prompt.name,
					serverName: prompt.serverName,
					error: errorMessage,
				});
				return infoMsg(
					`Failed to execute MCP prompt: ${errorMessage}`,
					'error',
				);
			}
		},
	};
}

/**
 * Get a user-friendly list of all MCP prompt commands
 */
export function getMCPPromptCommandsList(mcpClient: MCPClient): string[] {
	const prompts = mcpClient.getAllPrompts();
	return prompts.map(p => `mcp:${p.serverName}:${p.name}`);
}
