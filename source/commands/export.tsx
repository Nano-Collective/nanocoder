import fs from 'fs/promises';
import path from 'path';
import React from 'react';
import {ErrorMessage, SuccessMessage} from '@/components/message-box';
import {generateKey} from '@/session/key-generator';
import {Command, Message} from '@/types/index';
import {
	generateExportFilename,
	uniqueFilename,
} from '@/utils/generate-export-filename';
import {isValidFilePath} from '@/utils/path-validation';

const formatMessageContent = (message: Message) => {
	let content = '';
	switch (message.role) {
		case 'user':
			content += `## User\n${message.content}`;
			break;
		case 'assistant':
			content += `## Assistant\n${message.content || ''}`;
			if (message.tool_calls) {
				content += `\n\n[tool_use: ${message.tool_calls
					.map(tc => tc.function.name)
					.join(', ')}]`;
			}
			break;
		case 'tool':
			content +=
				`## Tool Output: ${message.name}\n` +
				'```\n' +
				`${message.content}\n` +
				'```\n';
			break;
		case 'system':
			// For now, we don't include system messages in the export
			return '';
		default:
			return '';
	}
	return content + '\n\n';
};

function Export({filename}: {filename: string}) {
	return (
		<SuccessMessage
			hideBox={true}
			marginTop={1}
			marginBottom={1}
			message={`Chat exported to ${filename}`}
		></SuccessMessage>
	);
}

function ExportError({message}: {message: string}) {
	return (
		<ErrorMessage
			hideBox={true}
			marginTop={1}
			marginBottom={1}
			message={message}
		></ErrorMessage>
	);
}

export const exportCommand: Command = {
	name: 'export',
	description: 'Export the chat history to a markdown file',
	handler: async (
		args: string[],
		messages: Message[],
		{provider, model, tokens},
	) => {
		const requestedFilename = args[0] || generateExportFilename(messages);

		if (!isValidFilePath(requestedFilename, process.cwd())) {
			return React.createElement(ExportError, {
				key: generateKey('export'),
				message: 'Invalid filename: path traversal detected',
			});
		}

		const filepath = path.resolve(process.cwd(), requestedFilename); // nosemgrep
		const safeFilepath = await uniqueFilename(filepath);
		const filename = path.basename(safeFilepath);

		const frontmatter = `---
session_date: ${new Date().toISOString()}
provider: ${provider}
model: ${model}
total_tokens: ${tokens}
---

# Nanocoder Chat Export

`;

		const markdownContent = messages.map(formatMessageContent).join('');

		await fs.writeFile(safeFilepath, frontmatter + markdownContent);

		return React.createElement(Export, {
			key: generateKey('export'),
			filename,
		});
	},
};
