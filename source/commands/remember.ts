import {SummarizerService} from '@/memory/summarizer-service';
import type {Command} from '@/types/commands';
import {formatError} from '@/utils/error-formatter';
import {errorMsg, successMsg} from '@/utils/message-factory';

interface RememberCommandOptions {
	summarizerService?: SummarizerService;
}

interface ParsedRememberArgs {
	content: string;
	category?: string;
	error?: string;
}

const USAGE = 'Usage: /remember [--category <name>] <project memory>';

export function createRememberCommand(
	options: RememberCommandOptions = {},
): Command {
	const summarizerService =
		options.summarizerService ?? new SummarizerService();

	return {
		name: 'remember',
		description: 'Save a durable project memory',
		handler: async (args: string[]) => {
			const parsed = parseRememberArgs(args);
			if (parsed.error) {
				return errorMsg(parsed.error, 'remember-error');
			}

			try {
				const memory = await summarizerService.remember({
					content: parsed.content,
					category: parsed.category,
				});

				return successMsg(
					`Remembered ${memory.category} memory.`,
					'remember-success',
				);
			} catch (error) {
				return errorMsg(
					`Failed to save memory: ${formatError(error)}`,
					'remember-error',
				);
			}
		},
	};
}

export const rememberCommand: Command = createRememberCommand();

function parseRememberArgs(args: string[]): ParsedRememberArgs {
	let category: string | undefined;
	const contentParts: string[] = [];

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === '--category' || arg === '-c') {
			const value = args[index + 1];
			if (!value) {
				return {content: '', error: USAGE};
			}

			category = value;
			index++;
			continue;
		}

		contentParts.push(arg);
	}

	const content = contentParts.join(' ').trim();
	if (!content) return {content: '', error: USAGE};

	return {content, category};
}
