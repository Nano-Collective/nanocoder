import {CheckpointManager} from '@/services/checkpoint-manager';
import type {MessageSubmissionOptions} from '@/types/index';
import {formatError} from '@/utils/error-formatter';
import {errorMsg, infoMsg} from '@/utils/message-factory';

/** Checkpoint subcommands that open the interactive picker. */
const CHECKPOINT_SUBCOMMANDS = {
	LOAD: 'load',
	RESTORE: 'restore',
} as const;

/**
 * Handles interactive checkpoint load command.
 * Returns true if checkpoint load was handled.
 */
export async function handleCheckpointLoad(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {
		onAddToChatQueue,
		onEnterCheckpointLoadMode,
		onCommandComplete,
		messages,
	} = options;

	const isCheckpointLoad =
		commandParts[0] === 'checkpoint' &&
		(commandParts[1] === CHECKPOINT_SUBCOMMANDS.LOAD ||
			commandParts[1] === CHECKPOINT_SUBCOMMANDS.RESTORE) &&
		commandParts.length === 2;

	if (!isCheckpointLoad) {
		return false;
	}

	try {
		const manager = new CheckpointManager();
		const checkpoints = await manager.listCheckpoints();

		if (checkpoints.length === 0) {
			onAddToChatQueue(
				infoMsg(
					'No checkpoints available. Create one with /checkpoint create [name]',
					'checkpoint-info',
				),
			);
			onCommandComplete?.();
			return true;
		}

		onEnterCheckpointLoadMode(checkpoints, messages.length);
		return true;
	} catch (error) {
		onAddToChatQueue(
			errorMsg(
				`Failed to list checkpoints: ${formatError(error)}`,
				'checkpoint-error',
			),
		);
		onCommandComplete?.();
		return true;
	}
}
