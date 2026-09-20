import {
	parseCommandParameterSpec,
	substituteTemplateVariables,
} from '@/custom-commands/parser';
import type {CustomCommand} from '@/types/index';
import {expandSections} from '@/utils/template-sections';

export class CustomCommandExecutor {
	/**
	 * Execute a custom command with given arguments
	 */
	execute(command: CustomCommand, args: string[]): string {
		// Build template variables from parameters and arguments
		const variables: Record<string, string> = {};

		if (command.metadata.parameters && command.metadata.parameters.length > 0) {
			// Map arguments to parameters positionally. A missing (or empty)
			// argument falls back to the parameter's inline default, if any.
			command.metadata.parameters.forEach((spec: string, index: number) => {
				const {name, defaultValue} = parseCommandParameterSpec(spec);
				const provided = args[index];
				variables[name] =
					provided !== undefined && provided !== '' ? provided : defaultValue;
			});

			// Also provide all args as a single variable
			variables['args'] = args.join(' ');
		}

		// Add some default context variables
		variables['cwd'] = process.cwd();
		variables['command'] = command.fullName;

		// Expand optional sections first so the body can drop clauses tied to an
		// omitted argument, then substitute the remaining {{ name }} variables.
		const sectioned = expandSections(
			command.content,
			name => (variables[name]?.length ?? 0) > 0,
		);
		const promptContent = substituteTemplateVariables(sectioned, variables);

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
				command.metadata.parameters
					.map((spec: string) => {
						const {name, defaultValue} = parseCommandParameterSpec(spec);
						// Conventional usage notation: <name> expected, [name=default]
						// optional with a fallback.
						return defaultValue ? `[${name}=${defaultValue}]` : `<${name}>`;
					})
					.join(' '),
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
