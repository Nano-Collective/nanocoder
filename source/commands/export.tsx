import fs from 'fs/promises';
import path from 'path';
import React from 'react';
import {
	explainInvalidExportPath,
	toProjectDisplayPath,
} from '@/commands/export-path';
import {ErrorMessage, SuccessMessage} from '@/components/message-box';
import {getProjectRoot, getSafeSessionCwd} from '@/services/session-cwd';
import {generateKey} from '@/session/key-generator';
import {Command, Message} from '@/types/index';
import {formatError} from '@/utils/error-formatter';
import {atomicWriteFile} from '@/utils/fs/atomic-write';
import {resolveFilePath} from '@/utils/fs/path-validation';
import {writeUniqueFile} from '@/utils/fs/write-unique-file';
import {generateExportFilename} from '@/utils/generate-export-filename';

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
		case 'tool': {
			const text = message.content || '';
			const ticks = text.match(/`{3,}/g) || [];
			const maxTicks =
				ticks.length > 0 ? Math.max(...ticks.map(m => m.length)) : 0;
			const len = Math.max(3, maxTicks + 1);
			const fence = '`'.repeat(len);
			content +=
				`## Tool Output: ${message.name}\n` +
				`${fence}\n` +
				`${text}\n` +
				`${fence}\n`;
			break;
		}
		case 'system':
			// For now, we don't include system messages in the export
			return '';
		default:
			return '';
	}
	return content + '\n\n';
};

function generateJsonExportFilename(messages: Message[]): string {
	return generateExportFilename(messages).replace(/\.md$/i, '.json');
}

function isJsonExport(filename: string): boolean {
	return filename.toLowerCase().endsWith('.json');
}

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
	description: 'Export the chat history to a markdown or JSON file',
	handler: async (
		args: string[],
		messages: Message[],
		{provider, model, tokens},
	) => {
		const jsonFlag = args[0] === '--json';
		const userProvided = jsonFlag ? Boolean(args[1]) : Boolean(args[0]);
		const jsonRequested = jsonFlag || isJsonExport(args[0] || '');
		const requestedFilename = jsonRequested
			? jsonFlag
				? args[1] || generateJsonExportFilename(messages)
				: args[0]
			: args[0] || generateExportFilename(messages);

		// Resolve against the session cwd (which honours bash `cd`) and enforce
		// containment within the project root (which does not shrink as `cd`
		// descends) -- the same convention as read_file / write_file / string_replace.
		const projectRoot = getProjectRoot();
		const sessionCwd = getSafeSessionCwd();
		let filepath: string;
		try {
			filepath = resolveFilePath(requestedFilename, sessionCwd, projectRoot);
		} catch {
			return React.createElement(ExportError, {
				key: generateKey('export'),
				message: `Invalid export path: ${explainInvalidExportPath(
					requestedFilename,
					projectRoot,
				)}`,
			});
		}

		const sessionDate = new Date().toISOString();
		const content = jsonRequested
			? `${JSON.stringify(
					{
						sessionDate,
						provider,
						model,
						totalTokens: tokens,
						sessionCwd,
						messages,
					},
					null,
					2,
				)}\n`
			: `---
session_date: ${sessionDate}
provider: ${provider}
model: ${model}
total_tokens: ${tokens}
---

# Nanocoder Chat Export

${messages.map(formatMessageContent).join('')}`;

		// A name the user typed keeps overwrite semantics (least surprise). Only
		// generated names get auto-suffixed so repeated exports never clobber.
		let writtenFilepath: string;
		try {
			if (jsonRequested && userProvided) {
				await atomicWriteFile(filepath, content);
				writtenFilepath = filepath;
			} else if (userProvided) {
				writtenFilepath = await fs
					.writeFile(filepath, content)
					.then(() => filepath);
			} else {
				writtenFilepath = await writeUniqueFile(filepath, content);
			}
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

		return React.createElement(Export, {
			key: generateKey('export'),
			filename: toProjectDisplayPath(writtenFilepath, projectRoot),
		});
	},
};
