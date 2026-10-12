import {
	CustomCommandExecutor,
	expandCustomCommandPrompt,
} from '@/custom-commands/executor';
import type {CustomCommand} from '@/types/index';

/**
 * Model text for a custom slash command. The typed line is not kept above
 * the body, and `{{args}}` is filled from what followed the command name.
 * Attachment sections go after the body so they never fill an argument.
 */
export function acpCustomCommandText(
	invocation: string,
	command: CustomCommand,
	sections: string[] = [],
): string {
	return [
		expandCustomCommandPrompt(command, invocation, new CustomCommandExecutor()),
		...sections,
	].join('\n\n');
}
