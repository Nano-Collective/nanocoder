import {parseCustomCommandArgs} from '@/custom-commands/args';
import type {Message, StatefulCommand} from '@/types/index';
import {errorMsg} from '@/utils/message-factory';

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

		await context.submitChatMessage(
			lastUserMessage.content,
			lastUserMessage.content,
		);
		// The retried chat turn owns its completion signal. Signalling another
		// one here can start the next queued prompt while that turn unwinds.
		return 'handed-off';
	},
};
