import {expandCustomCommandPrompt} from '@/custom-commands/executor';
import type {CustomCommand} from '@/types/index';

/**
 * Model text for a custom slash command. The typed line is not kept above
 * the body, and `{{args}}` is filled from what followed the command name.
 */
export function acpCustomCommandText(
	invocation: string,
	command: CustomCommand,
): string {
	return expandCustomCommandPrompt(command, invocation);
}
