/**
 * /copy command
 * Copies the last assistant response to the system clipboard.
 */
import clipboard from 'clipboardy';
import type {Command} from '@/types/commands';
import type {Message} from '@/types/core';
import {errorMsg, successMsg, warningMsg} from '@/utils/message-factory';

function findLastAssistantContent(messages: Message[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role === 'assistant' && message.content) {
			return message.content;
		}
	}
	return undefined;
}

export const copyCommand: Command = {
	name: 'copy',
	description: 'Copy the last assistant response to the clipboard',
	handler: async (_args, messages) => {
		const content = findLastAssistantContent(messages);

		if (!content) {
			return warningMsg('No assistant response to copy yet.', 'copy');
		}

		try {
			await clipboard.write(content);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return errorMsg(`Failed to copy to clipboard: ${detail}`, 'copy');
		}

		return successMsg(
			`Copied last response to clipboard (${content.length} chars)`,
			'copy',
		);
	},
};
