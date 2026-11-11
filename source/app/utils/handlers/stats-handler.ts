import {createStatsDisplayElement} from '@/commands/stats';
import {resetStatsLedger} from '@/stats/record';
import type {MessageSubmissionOptions} from '@/types/index';
import {errorMsg, infoMsg} from '@/utils/message-factory';

/**
 * Handles /stats as a live component so ←/→ can switch ranges without the
 * chat composer swallowing the keys.
 * Returns true if handled.
 */
export function handleStatsCommand(
	commandParts: string[],
	options: MessageSubmissionOptions,
): boolean {
	if (commandParts[0] !== 'stats') {
		return false;
	}

	const {
		setLiveComponent,
		setLiveComponentCapturesInput,
		onAddToChatQueue,
		onCommandComplete,
	} = options;

	const args = commandParts.slice(1);
	const resetArg = args[0]?.toLowerCase();
	if (resetArg === 'reset' || resetArg === '--reset') {
		if (args.length !== 1) {
			onAddToChatQueue(
				errorMsg('Usage: /stats [7d|3m|all-time|reset]', 'stats-error'),
			);
			onCommandComplete?.();
			return true;
		}
		resetStatsLedger();
		onAddToChatQueue(infoMsg('Lifetime stats reset.', 'stats-reset'));
		onCommandComplete?.();
		return true;
	}

	setLiveComponentCapturesInput(true);

	const close = () => {
		// Leave a static snapshot in the transcript, then release focus.
		onAddToChatQueue(
			createStatsDisplayElement({
				args,
				interactive: false,
			}),
		);
		setLiveComponent(null);
		setLiveComponentCapturesInput(false);
		onCommandComplete?.();
	};

	setLiveComponent(
		createStatsDisplayElement({
			args,
			interactive: true,
			onClose: close,
		}),
	);

	return true;
}
