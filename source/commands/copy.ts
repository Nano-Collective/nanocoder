/**
 * /copy command
 * Copies the last assistant response to the system clipboard.
 */
import clipboard from 'clipboardy';
import type {Command} from '@/types/commands';
import type {Message} from '@/types/core';
import {errorMsg, successMsg, warningMsg} from '@/utils/message-factory';

export function findLastAssistantContent(
	messages: Message[],
): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role === 'assistant' && message.content) {
			return message.content;
		}
	}
	return undefined;
}

/**
 * Extracts the raw source of the last fenced code block in a markdown string.
 * Fences must sit at the start of a line (same convention as the markdown
 * parser); leading indent on the opening fence is stripped from each line.
 */
export function findLastCodeBlock(markdown: string): string | undefined {
	const matches = [
		...markdown.matchAll(/^([ \t]*)```[^\n]*\n([\s\S]*?)^\1```/gm),
	];
	const last = matches[matches.length - 1];
	if (!last) return undefined;
	const indent = last[1] ?? '';
	const code = last[2] ?? '';
	const dedented = indent
		? code
				.split('\n')
				.map(line =>
					line.startsWith(indent) ? line.slice(indent.length) : line,
				)
				.join('\n')
		: code;
	return dedented.replace(/\n$/, '') || undefined;
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
			`Copied last response to clipboard (${content.length.toLocaleString()} characters)`,
			'copy',
		);
	},
};
