import {
	parseCommandParameterSpec,
	substituteTemplateVariables,
} from '@/custom-commands/parser';
import type {CustomCommand} from '@/types/index';
import {expandSections} from '@/utils/template-sections';

/**
 * Render declared parameters in conventional usage notation: `<name>` for
 * an expected argument, `[name=default]` for one with a fallback. Returns
 * an empty string when there are no parameters.
 */
export function formatParameterUsage(parameters?: string[]): string {
	if (!parameters || parameters.length === 0) return '';
	return parameters
		.map(spec => {
			const {name, defaultValue} = parseCommandParameterSpec(spec);
			return defaultValue ? `[${name}=${defaultValue}]` : `<${name}>`;
		})
		.join(' ');
}

export class CustomCommandExecutor {
	/**
	 * Execute a custom command with given arguments.
	 *
	 * `args` are the shell-style parsed tokens that fill declared parameters
	 * positionally. `rawArgs` is the text exactly as typed after the command
	 * name; `{{args}}` uses it when given, because re-joining the tokens strips
	 * quotes and eats apostrophes ("don't" parses as an opening quote).
	 */
	execute(command: CustomCommand, args: string[], rawArgs?: string): string {
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
		}

		// Also provide all args as a single variable
		variables['args'] = rawArgs ?? args.join(' ');

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

		const usage = formatParameterUsage(command.metadata.parameters);
		if (usage) parts.push(usage);

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
