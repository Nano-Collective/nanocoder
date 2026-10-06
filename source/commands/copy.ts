/**
 * /copy command
 * Copies the last assistant response to the system clipboard.
 * `/copy code` copies just the last fenced code block from that response.
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

/**
 * Extract raw bodies of fenced code blocks from markdown.
 *
 * Mirrors the fence recognition in `source/markdown-parser/index.ts`: both
 * fences must sit at the start of a line (after optional spaces/tabs only)
 * so fences nested inside a blockquote (`> ``` `) are not treated as
 * copyable code. Leading indentation on the opening fence is stripped from
 * each content line so indented fences (e.g. inside a list item) copy
 * cleanly. Matches the VS Code webview behaviour of copying the most
 * recent (last) block — callers pick `blocks[blocks.length - 1]`.
 */
function extractCodeBlocks(markdown: string): string[] {
	const blocks: string[] = [];
	const pattern =
		/^([ \t]*)```[a-zA-Z0-9\-+#]*[ \t]*\r?\n([\s\S]*?)^\1```[ \t]*$/gm;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(markdown)) !== null) {
		const indent = match[1] ?? '';
		let code = match[2] ?? '';
		if (indent) {
			code = code
				.split('\n')
				.map(line =>
					line.startsWith(indent) ? line.slice(indent.length) : line,
				)
				.join('\n');
		}
		// The capture includes the newline before the closing fence; drop one
		// trailing newline to match the webview's `textContent.replace(/\n$/, '')`.
		code = code.replace(/\r?\n$/, '');
		blocks.push(code);
	}
	return blocks;
}

export const copyCommand: Command = {
	name: 'copy',
	description: 'Copy the last assistant response to the clipboard',
	handler: async (args, messages) => {
		if (args[0]?.toLowerCase() === 'code') {
			const content = findLastAssistantContent(messages);

			if (!content) {
				return warningMsg('No assistant response to copy yet.', 'copy');
			}

			const blocks = extractCodeBlocks(content);

			if (blocks.length === 0) {
				return warningMsg('No code blocks found in the last response.', 'copy');
			}

			// Copy the most recent block, matching the VS Code webview's
			// `/copy code` (last `pre code` of the last turn).
			const code = blocks[blocks.length - 1] ?? '';

			try {
				await clipboard.write(code);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				return errorMsg(`Failed to copy to clipboard: ${detail}`, 'copy');
			}

			const lineCount = code === '' ? 0 : code.split('\n').length;
			return successMsg(
				`Copied code block to clipboard (${lineCount} ${lineCount === 1 ? 'line' : 'lines'})`,
				'copy',
			);
		}

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
