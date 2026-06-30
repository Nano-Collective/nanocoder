import type {MessageSubmissionOptions} from '@/types/index';
import {errorMsg} from '@/utils/message-factory';

const RETRY_COMMAND = 'retry';

interface RetryArgs {
	model?: string;
	provider?: string;
}

function findLastUserMessage(messages: MessageSubmissionOptions['messages']) {
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

export async function handleRetryCommand(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const commandName = commandParts[0]?.toLowerCase();
	if (commandName !== RETRY_COMMAND) {
		return false;
	}

	const lastUserMessage = findLastUserMessage(options.messages);
	if (!lastUserMessage) {
		options.onAddToChatQueue(
			errorMsg('No user message to retry yet.', 'retry-error'),
		);
		options.onCommandComplete?.();
		return true;
	}

	const {model, provider} = parseRetryArgs(commandParts.slice(1));
	if (model) {
		if (!options.onSwitchModel) {
			options.onAddToChatQueue(
				errorMsg(
					'Model switching is not available in this context.',
					'retry-error',
				),
			);
			options.onCommandComplete?.();
			return true;
		}

		const switched = await options.onSwitchModel(
			provider ?? options.provider,
			model,
		);
		if (!switched) {
			options.onCommandComplete?.();
			return true;
		}
	}

	await options.onHandleChatMessage(
		lastUserMessage.content,
		lastUserMessage.content,
	);
	options.onCommandComplete?.();
	return true;
}
