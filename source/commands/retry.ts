import {isInternalWalkthroughMessage} from '@/artifacts/walkthrough-lifecycle';
import {errorMsg} from '@/components/message-factory';
import {
	ARCHITECT_REVERT_NOTICE_PREFIX,
	BASH_OUTPUT_PREFIX,
	COMPACTION_RETRY_NOTICE,
} from '@/constants';
import {parseCustomCommandArgs} from '@/custom-commands/args';
import {isAutoDiagnosticsMessage} from '@/hooks/chat-handler/conversation/auto-diagnostics';
import {isTurnRecoveryNotice} from '@/hooks/chat-handler/utils/headless-retry-guards';
import {isEvidenceRejectionMessage} from '@/services/completion-ledger';
import type {Message, StatefulCommand} from '@/types/index';
import {stripTurnContext} from '@/utils/turn-context';

interface RetryArgs {
	model?: string;
	provider?: string;
}

function findRetryTarget(messages: Message[]) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (
			message?.role !== 'user' ||
			message.displayOnly ||
			message.synthetic ||
			// Legacy shell output is formatted in source/app/utils/app-util.ts.
			message.content.startsWith(BASH_OUTPUT_PREFIX + '\n```\n$ ') ||
			message.content.startsWith(ARCHITECT_REVERT_NOTICE_PREFIX) ||
			message.content === COMPACTION_RETRY_NOTICE ||
			// Summaries are formatted in source/conversation/compaction/llm-summariser.ts.
			message.content.startsWith('<conversation-summary>\n') ||
			isTurnRecoveryNotice(message.content) ||
			isInternalWalkthroughMessage(message) ||
			isAutoDiagnosticsMessage(message) ||
			isEvidenceRejectionMessage(message)
		) {
			continue;
		}

		// Rebuild per-turn context for the retried prompt, including image-only turns.
		const text = stripTurnContext(message.content);
		if (text.trim() || message.images?.length) {
			return {index, text, images: message.images};
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
		const target = findRetryTarget(context.messages);
		if (!target) {
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

		await context.submitChatMessage(target.text, target.text, {
			images: target.images,
			replaceFrom: target.index,
		});
		// The retried chat turn owns its completion signal. Signalling another
		// one here can start the next queued prompt while that turn unwinds.
		return 'handed-off';
	},
};
