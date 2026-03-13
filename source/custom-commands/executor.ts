import {substituteTemplateVariables} from '@/custom-commands/parser';
import type {CustomCommand} from '@/types/index';

export class CustomCommandExecutor {
	/**
	 * Execute a custom command with given arguments
	 */
	execute(command: CustomCommand, args: string[]): string {
		// Build template variables from parameters and arguments
		const variables: Record<string, string> = {};

		if (command.metadata.parameters && command.metadata.parameters.length > 0) {
			// Map arguments to parameters
			command.metadata.parameters.forEach((param: string, index: number) => {
				variables[param] = args[index] || '';
			});

			// Also provide all args as a single variable
			variables['args'] = args.join(' ');
		}

		// Add some default context variables
		variables['cwd'] = process.cwd();
		variables['command'] = command.fullName;

		// Substitute variables in the command content
		const promptContent = substituteTemplateVariables(
			command.content,
			variables,
		);

		// Build the full prompt
		let fullPrompt = `[Executing custom command: /${command.fullName}]\n\n${promptContent}`;

		// Append resource information if available
		if (command.loadedResources?.length) {
			fullPrompt += '\n\n[Available resources:';
			for (const r of command.loadedResources) {
				fullPrompt += `\n  - ${r.name} (${r.type})`;
			}
			fullPrompt += ']';
		}

		fullPrompt +=
			'\n\n[Note: If this custom command could be improved, please provide feedback on how to enhance it.]';

		// Execute the prompt as if the user typed it
		return fullPrompt;
	}

	/**
	 * Format command help text
	 */
	formatHelp(command: CustomCommand): string {
		const parts: string[] = [`/${command.fullName}`];

		if (command.metadata.parameters && command.metadata.parameters.length > 0) {
			parts.push(
				command.metadata.parameters.map((p: string) => `<${p}>`).join(' '),
			);
		}

		if (command.metadata.description) {
			parts.push(`- ${command.metadata.description}`);
		}

		if (command.metadata.aliases && command.metadata.aliases.length > 0) {
			const aliasNames = command.metadata.aliases.map((a: string) =>
				command.namespace ? `${command.namespace}:${a}` : a,
			);
			parts.push(`(aliases: ${aliasNames.join(', ')})`);
		}

		return parts.join(' ');
	}
}
