import {errorMsg} from '@/components/message-factory';
import {parseCustomCommandArgs} from '@/custom-commands/args';
import type {Message, StatefulCommand} from '@/types/index';
import {stripTurnContext} from '@/utils/turn-context';

interface RetryArgs {
	model?: string;
	provider?: string;
}

function findLastUserMessage(messages: Message[]) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === 'user' && message.content.trim()) {
			return message;
		}
	}

	return undefined;
}

const RETRY_USAGE =
	'Usage: /retry [--model <id>] or /retry --provider <name> --model <id>';

const RETRY_FLAGS = {'--model': 'model', '--provider': 'provider'} as const;

// Every argument must be one /retry can use: an argument it cannot read is an
// error, so a typo never re-sends the prompt on a model the user did not pick.
function parseRetryArgs(args: string[]): RetryArgs | {error: string} {
	const parsed: RetryArgs = {};

	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? '';
		const equals = arg.indexOf('=');
		const flag = equals === -1 ? arg : arg.slice(0, equals);
		const key = RETRY_FLAGS[flag as keyof typeof RETRY_FLAGS];
		if (!key) {
			return {error: `Unknown argument "${arg}".`};
		}

		// --model <id> or --model=<id>
		let value: string | undefined;
		if (equals === -1) {
			const next = args[index + 1];
			if (next !== undefined && !next.startsWith('--')) {
				value = next;
				index++;
			}
		} else {
			value = arg.slice(equals + 1);
		}
		if (!value) {
			return {error: `${flag} needs a value.`};
		}
		parsed[key] = value;
	}

	if (parsed.provider && !parsed.model) {
		return {error: '--provider needs --model as well.'};
	}

	return parsed;
}

export const retryCommand: StatefulCommand = {
	name: 'retry',
	description:
		'Re-run the last user turn (use --model <id> to switch models first)',
	run: async context => {
		const lastUserMessage = findLastUserMessage(context.messages);
		if (!lastUserMessage) {
			context.addToChatQueue(
				errorMsg('No user message to retry yet.', 'retry-error'),
			);
			return 'done';
		}

		// Quote-aware, so `--model "name with spaces"` stays one value.
		const parsed = parseRetryArgs(parseCustomCommandArgs(context.argText));
		if ('error' in parsed) {
			context.addToChatQueue(
				errorMsg(`${parsed.error} ${RETRY_USAGE}`, 'retry-error'),
			);
			return 'done';
		}
		const {model, provider} = parsed;
		if (model) {
			if (!context.switchModel) {
				context.addToChatQueue(
					errorMsg(
						'Model switching is not available in this context.',
						'retry-error',
					),
				);
				return 'done';
			}

			const switched = await context.switchModel(
				provider ?? context.provider,
				model,
			);
			if (!switched) {
				return 'done';
			}
		}

		// The stored message carries last turn's context block (#1574). Re-submit
		// only what the user typed: handleChatMessage builds a fresh block for
		// this turn, so passing the stored text would wrap one block inside
		// another and — worse — match skills and recall memories against a query
		// containing the previous turn's own recalled context.
		const retryText = stripTurnContext(lastUserMessage.content);
		await context.submitChatMessage(retryText, retryText);
		// The retried chat turn owns its completion signal. Signalling another
		// one here can start the next queued prompt while that turn unwinds.
		return 'handed-off';
	},
};
