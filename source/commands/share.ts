import path from 'path';
import {
	explainInvalidExportPath,
	toProjectDisplayPath,
} from '@/commands/export-path';
import {renderShareHtml} from '@/commands/share-html';
import {
	buildSharePayload,
	firstUserRequest,
	serializeSharePayload,
} from '@/commands/share-payload';
import {errorMsg, successMsg, warningMsg} from '@/components/message-factory';
import {getAppConfig} from '@/config/index';
import {getProjectRoot, getSafeSessionCwd} from '@/services/session-cwd';
import type {Command} from '@/types/index';
import {formatError} from '@/utils/error-formatter';
import {atomicWriteFile} from '@/utils/fs/atomic-write';
import {resolveFilePath} from '@/utils/fs/path-validation';
import {writeUniqueFile} from '@/utils/fs/write-unique-file';
import {generateExportFilename} from '@/utils/generate-export-filename';

const USAGE = '/share [--json] [--no-redact] [filename]';

interface ShareArgs {
	json: boolean;
	redact: boolean;
	filename?: string;
}

function parseShareArgs(args: string[]): ShareArgs | {error: string} {
	const parsed: ShareArgs = {json: false, redact: true};
	for (const arg of args) {
		if (arg === '--json') {
			parsed.json = true;
		} else if (arg === '--no-redact') {
			parsed.redact = false;
		} else if (arg.startsWith('-')) {
			// Also catches a single-dash typo such as -json, which would
			// otherwise be taken as the filename.
			return {error: `Unknown option ${arg}. Usage: ${USAGE}`};
		} else if (parsed.filename !== undefined) {
			return {error: `Give at most one filename. Usage: ${USAGE}`};
		} else {
			parsed.filename = arg;
		}
	}
	// As with /export, a .json filename selects JSON on its own.
	if (parsed.filename?.toLowerCase().endsWith('.json')) {
		parsed.json = true;
	}
	return parsed;
}

/**
 * API keys written into agents.config.json are not in the environment, so
 * the env scan in redactSecrets cannot see them. Mask them literally too.
 */
function configuredApiKeys(): string[] {
	try {
		return (getAppConfig().providers ?? []).flatMap(provider =>
			provider.apiKey ? [provider.apiKey] : [],
		);
	} catch {
		return [];
	}
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export const shareCommand: Command = {
	name: 'share',
	description:
		'Write the session to a self-contained HTML page you can share, with secrets redacted (--json for JSON, --no-redact to keep secrets)',
	handler: async (args: string[], messages, {provider, model}) => {
		const parsed = parseShareArgs(args);
		if ('error' in parsed) {
			return errorMsg(parsed.error, 'share');
		}

		const {payload, redactionCount} = buildSharePayload(
			messages,
			{provider, model},
			{
				redact: parsed.redact,
				extraSecrets: parsed.redact ? configuredApiKeys() : [],
			},
		);
		if (payload.messages.length === 0) {
			return errorMsg(
				'Nothing to share yet: the session has no messages.',
				'share',
			);
		}

		// The generated name is a slug of the first request, the same turn the
		// page title shows. It is built from the redacted payload, so a key
		// pasted into that prompt does not end up in the filename.
		const userProvided = parsed.filename !== undefined;
		const request = firstUserRequest(payload.messages);
		const requestedFilename =
			parsed.filename ??
			generateExportFilename(
				request ? [{role: 'user', content: request.content}] : [],
			).replace(/\.md$/i, parsed.json ? '.json' : '.html');

		// Same rules as /export: resolve against the session cwd, and keep the
		// file inside the project root.
		const projectRoot = getProjectRoot();
		let filepath: string;
		try {
			filepath = resolveFilePath(
				requestedFilename,
				getSafeSessionCwd(),
				projectRoot,
			);
		} catch {
			return errorMsg(
				`Invalid share path: ${explainInvalidExportPath(
					requestedFilename,
					projectRoot,
				)}`,
				'share',
			);
		}

		const content = parsed.json
			? serializeSharePayload(payload)
			: renderShareHtml(payload);

		// A name the user typed is overwritten, as with /export; a generated
		// name gets a numeric suffix so repeated shares never clobber each other.
		let writtenFilepath: string;
		try {
			if (userProvided) {
				await atomicWriteFile(filepath, content);
				writtenFilepath = filepath;
			} else {
				writtenFilepath = await writeUniqueFile(filepath, content);
			}
		} catch (error) {
			const message =
				error &&
				typeof error === 'object' &&
				'code' in error &&
				error.code === 'ENOENT'
					? `Parent directory does not exist: ${path.dirname(filepath)}`
					: formatError(error);
			return errorMsg(`Failed to share the session: ${message}`, 'share');
		}

		// "Wrote", not "shared": nothing leaves the machine until the user sends
		// the file somewhere.
		const lines = [
			`Wrote the session ${parsed.json ? 'JSON' : 'page'} to ${toProjectDisplayPath(writtenFilepath, projectRoot)}`,
		];
		if (!parsed.json) {
			lines.push(
				'Open it in any browser, or send the file: it is one static page with no scripts.',
			);
		}
		if (!parsed.redact) {
			lines.push(
				'Secrets were NOT redacted (--no-redact). Read it before you send it.',
			);
			return warningMsg(lines.join('\n'), 'share');
		}
		lines.push(
			redactionCount > 0
				? `Redacted ${plural(redactionCount, 'secret')}. Only known secret formats are caught, so read it before you send it.`
				: 'No secrets found to redact. Only known secret formats are caught, so read it before you send it.',
		);
		return successMsg(lines.join('\n'), 'share');
	},
};
