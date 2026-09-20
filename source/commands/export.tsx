import fs from 'fs/promises';
import path from 'path';
import React from 'react';
import {SuccessMessage} from '@/components/message-box';
import {generateKey} from '@/session/key-generator';
import {Command, Message} from '@/types/index';

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

export const exportCommand: Command = {
	name: 'export',
	description: 'Export the chat history to a markdown file',
	handler: async (
		args: string[],
		messages: Message[],
		{provider, model, tokens},
	) => {
		const filename =
			args[0] ||
			`nanocoder-chat-${new Date().toISOString().replace(/:/g, '-')}.md`;
		const filepath = path.resolve(process.cwd(), filename); // nosemgrep

		const frontmatter = `---
session_date: ${new Date().toISOString()}
provider: ${provider}
model: ${model}
total_tokens: ${tokens}
---

# Nanocoder Chat Export

`;

		const markdownContent = messages.map(formatMessageContent).join('');

		await fs.writeFile(filepath, frontmatter + markdownContent);

		return React.createElement(Export, {
			key: generateKey('export'),
			filename,
		});
	},
};
