import fs from 'fs/promises';
import path from 'path';
import React from 'react';
import {ErrorMessage, SuccessMessage} from '@/components/message-box';
import {getProjectRoot, getSafeSessionCwd} from '@/services/session-cwd';
import {generateKey} from '@/session/key-generator';
import {Command, Message} from '@/types/index';
import {formatError} from '@/utils/error-formatter';
import {
	generateExportFilename,
	writeUniqueFile,
} from '@/utils/generate-export-filename';
import {resolveFilePath} from '@/utils/path-validation';

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
		const userProvided = args.length > 0;
		const requestedFilename = args[0] || generateExportFilename(messages);

		// Resolve against the session cwd (which honours bash `cd`) and enforce
		// containment within the project root (which does not shrink as `cd`
		// descends) -- the same convention as read_file / write_file / string_replace.
		let filepath: string;
		try {
			filepath = resolveFilePath(
				requestedFilename,
				getSafeSessionCwd(),
				getProjectRoot(),
			);
		} catch {
			return React.createElement(ExportError, {
				key: generateKey('export'),
				message: 'Invalid export path: outside the project directory',
			});
		}

		const frontmatter = `---
session_date: ${new Date().toISOString()}
provider: ${provider}
model: ${model}
total_tokens: ${tokens}
---

# Nanocoder Chat Export

`;

		const markdownContent =
			frontmatter + messages.map(formatMessageContent).join('');

		// A name the user typed keeps overwrite semantics (least surprise). Only
		// generated names get auto-suffixed so repeated exports never clobber --
		// and the write is atomic ('wx') so concurrent exports can't race.
		let writtenFilepath: string;
		try {
			writtenFilepath = userProvided
				? await fs.writeFile(filepath, markdownContent).then(() => filepath)
				: await writeUniqueFile(filepath, markdownContent);
		} catch (error) {
			// writeUniqueFile already translates a missing parent dir for
			// generated names; mirror it for user-typed names that write directly.
			const message =
				error &&
				typeof error === 'object' &&
				'code' in error &&
				error.code === 'ENOENT'
					? `Parent directory does not exist: ${path.dirname(filepath)}`
					: formatError(error);
			return React.createElement(ExportError, {
				key: generateKey('export'),
				message: `Failed to export chat: ${message}`,
			});
		}

		// Show the exported file relative to the project root so subdirectory
		// exports (e.g. reports/chat.md) are recognisable rather than a bare basename.
		const root = getProjectRoot();
		const displayPath = writtenFilepath.startsWith(root + path.sep)
			? writtenFilepath.slice(root.length + 1)
			: writtenFilepath;

		return React.createElement(Export, {
			key: generateKey('export'),
			filename: displayPath,
		});
	},
};
