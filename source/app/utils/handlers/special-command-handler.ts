import {
	SETTINGS_TAB_IDS,
	type SettingsTabId,
} from '@/app/components/settings-constants';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {CheckpointManager} from '@/services/checkpoint-manager';
import type {MessageSubmissionOptions} from '@/types/index';
import {formatError} from '@/utils/error-formatter';
import {errorMsg, infoMsg} from '@/utils/message-factory';

/**
 * Commands that still need app state through the old route: their modules in
 * `source/commands/` are stubs (so they appear in the slash menu and `/help`)
 * and the work happens here. New stateful commands do not go here: they
 * export a `StatefulCommand` and receive a `CommandContext` from the
 * dispatcher (see `command-dispatcher.ts`). These are being moved over.
 */
const SPECIAL_COMMANDS = {
	MODEL: 'model',
	SETTINGS: 'settings',
	CHECKPOINT: 'checkpoint',
	EXPLORER: 'explorer',
	IDE: 'ide',
	TUNE: 'tune',
} as const;

const MODEL_BROWSE_SUBCOMMAND = 'browse';

/** Retired in favour of `/settings`; forwarded so they don't error out. */
const RETIRED_SETUP_COMMANDS: Record<string, SettingsTabId> = {
	'setup-providers': 'providers',
	'setup-mcp': 'mcp',
};

/** Checkpoint subcommands */
const CHECKPOINT_SUBCOMMANDS = {
	LOAD: 'load',
	RESTORE: 'restore',
} as const;

function isSettingsTabId(value: string): value is SettingsTabId {
	return (SETTINGS_TAB_IDS as readonly string[]).includes(value);
}

/**
 * Handles special commands that need app state access (/model, /settings, etc.)
 * Returns true if a special command was handled.
 */
export async function handleSpecialCommand(
	commandName: string,
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {
		onEnterModelSelectionMode,
		onEnterModelDatabaseMode,
		onEnterSettingsMode,
		onEnterExplorerMode,
		onCommandComplete,
		onAddToChatQueue,
		commandArgs,
	} = options;

	// Commands that just switch the app into a mode and complete share the
	// exact same shape, so dispatch them from a table instead of the switch.
	// `/model browse` (formerly /model-database) opens the models.dev browser
	// instead of the configured-model picker.
	const enterModeCommands: Record<string, () => void> = {
		[SPECIAL_COMMANDS.MODEL]:
			commandArgs?.[0]?.toLowerCase() === MODEL_BROWSE_SUBCOMMAND
				? onEnterModelDatabaseMode
				: onEnterModelSelectionMode,
		[SPECIAL_COMMANDS.EXPLORER]: onEnterExplorerMode,
		[SPECIAL_COMMANDS.IDE]: options.onEnterIdeSelectionMode,
		[SPECIAL_COMMANDS.TUNE]: options.onEnterTune,
	};

	const enterMode = enterModeCommands[commandName];
	if (enterMode) {
		enterMode();
		onCommandComplete?.();
		return true;
	}

	const retiredTab = RETIRED_SETUP_COMMANDS[commandName];
	if (retiredTab) {
		onAddToChatQueue(
			infoMsg(
				`/${commandName} has moved to /settings — opening the ${retiredTab} tab. Use /settings ${retiredTab} next time.`,
				`${commandName}-retired`,
			),
		);
		onEnterSettingsMode(retiredTab);
		onCommandComplete?.();
		return true;
	}

	switch (commandName) {
		case SPECIAL_COMMANDS.SETTINGS: {
			const rawTab = commandArgs?.[0];
			const tabArg = rawTab?.toLowerCase();
			let tab: SettingsTabId | undefined;
			if (tabArg) {
				if (!isSettingsTabId(tabArg)) {
					onAddToChatQueue(
						errorMsg(
							`Unknown settings tab: "${rawTab}". Valid tabs: ${SETTINGS_TAB_IDS.join(', ')}`,
							'settings-error',
						),
					);
					setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
					return true;
				}
				tab = tabArg;
			}
			onEnterSettingsMode(tab);
			onCommandComplete?.();
			return true;
		}
		default:
			return false;
	}
}

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
		commandParts[0] === SPECIAL_COMMANDS.CHECKPOINT &&
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
