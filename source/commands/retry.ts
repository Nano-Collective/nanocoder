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

function parseRetryArgs(args: string[]): RetryArgs {
	const parsed: RetryArgs = {};

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		const next = args[index + 1];

		if (arg === '--model' && next) {
			parsed.model = next;
			index++;
			continue;
		}

		if (arg === '--provider' && next) {
			parsed.provider = next;
			index++;
		}
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
		const {model, provider} = parseRetryArgs(
			parseCustomCommandArgs(context.argText),
		);
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
