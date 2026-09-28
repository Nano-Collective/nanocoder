import React from 'react';
import {CheckpointListDisplay} from '@/components/checkpoint-display';
import {
	InfoMessage,
	SuccessMessage,
	WarningMessage,
} from '@/components/message-box';
import {CheckpointManager} from '@/services/checkpoint-manager';
import {clearPendingHookContext} from '@/services/lifecycle-hooks';
import {generateKey} from '@/session/key-generator';
import {Command, Message} from '@/types/index';
import type {LLMClient} from '@/types/core';
import {describeGapsMessage} from '@/utils/checkpoint-utils';
import {formatError} from '@/utils/error-formatter';
import {
	errorMsg,
	infoMsg,
	successMsg,
	warningMsg,
} from '@/utils/message-factory';
import {addToMessageQueue} from '@/utils/message-queue';
import {clearReadTracker} from '@/utils/read-tracker';
import {clearExpandableToolResults} from '@/utils/tool-result-display';

// Default checkpoint manager instance (lazy-initialized)
let defaultCheckpointManager: CheckpointManager | null = null;

/**
 * Get or create the default checkpoint manager.
 * For testing, use createCheckpointCommand() with a custom manager.
 */
function getDefaultCheckpointManager(): CheckpointManager {
	if (!defaultCheckpointManager) {
		defaultCheckpointManager = new CheckpointManager();
	}
	return defaultCheckpointManager;
}

/**
 * Show checkpoint command help
 */
function CheckpointHelp() {
	return (
		<InfoMessage
			message={`Checkpoint Commands:

/checkpoint create [name] - Create a new checkpoint
  • Creates a snapshot of current conversation and modified files
  • Auto-generates timestamped name if not provided
  • Example: /checkpoint create feature-auth-v1

/checkpoint list - List all available checkpoints
  • Shows checkpoint name, creation time, message count, and files changed

/checkpoint load [name] - Restore files from a checkpoint
  • Without a name, choose from available checkpoints interactively
  • The interactive selector offers to back up the current session first
  • With a name, restores immediately (no prompt)
  • Restores files only; the conversation is not restored

/checkpoint delete <name> - Delete a specific checkpoint
  • Permanently removes the checkpoint and all its data, immediately

/checkpoint help - Show this help message

Aliases: save (create), ls (list), restore (load), remove/rm (delete)

Note: Checkpoints are stored in .nanocoder/checkpoints in the project.`}
			hideBox={false}
		/>
	);
}

/**
 * Create checkpoint subcommand
 */
async function createCheckpoint(
	args: string[],
	messages: Message[],
	metadata: {provider: string; model: string},
): Promise<React.ReactElement> {
	try {
		const manager = getDefaultCheckpointManager();
		const name = args.length > 0 ? args.join(' ') : undefined;

		if (messages.length === 0) {
			return warningMsg(
				'No messages to checkpoint. Start a conversation first.',
				'warning',
			);
		}

		const checkpointMetadata = await manager.saveCheckpoint(
			name,
			messages,
			metadata.provider,
			metadata.model,
		);

		const captured = checkpointMetadata.filesChanged;
		const filesLine =
			captured.length === 0
				? 'No modified files to capture'
				: `${captured.length} files captured: ${captured.slice(0, 3).join(', ')}${
						captured.length > 3 ? '...' : ''
					}`;

		return successMsg(
			`Checkpoint '${checkpointMetadata.name}' created successfully
  └─ ${checkpointMetadata.messageCount} messages saved
  └─ ${filesLine}
  └─ Provider: ${checkpointMetadata.provider.name} (${
		checkpointMetadata.provider.model
	})`,
			'success',
		);
	} catch (error) {
		return errorMsg(
			`Failed to create checkpoint: ${formatError(error)}`,
			'error',
		);
	}
}

/**
 * List checkpoints subcommand
 */
async function listCheckpoints(): Promise<React.ReactElement> {
	try {
		const manager = getDefaultCheckpointManager();
		const checkpoints = await manager.listCheckpoints();

		return React.createElement(CheckpointListDisplay, {
			key: generateKey('list'),
			checkpoints,
		});
	} catch (error) {
		return errorMsg(
			`Failed to list checkpoints: ${formatError(error)}`,
			'error',
		);
	}
}

/**
 * Roll the transcript back to the checkpointed conversation and reset all
 * per-conversation state that points into the discarded transcript.
 *
 * Mirrors `createClearMessagesHandler` (used by /clear): restoring is a clear
 * followed by replaying the checkpointed messages, so it needs the same three
 * clearers plus a client context reset. Without them `/expand` can resurrect
 * cached tool results from the thrown-away transcript and the next prompt can
 * be prepended with stale session-start hook output.
 */
export async function restoreCheckpointConversation(
	restoredMessages: Message[],
	options: {
		setMessages?: (messages: Message[]) => void;
		client?: LLMClient | null;
	},
): Promise<void> {
	options.setMessages?.([...restoredMessages]);
	// Drop read-before-edit history so a stale "seen" from the discarded
	// conversation can't authorize a blind edit after the restore.
	clearReadTracker();
	// Expandable tool results point into the transcript being discarded.
	clearExpandableToolResults();
	// Undelivered session-start hook context belongs to the discarded
	// conversation — don't graft it onto the restored one.
	clearPendingHookContext();
	if (options.client) {
		await options.client.clearContext();
	}
}

/**
 * Load checkpoint subcommand
 */
async function loadCheckpoint(
	args: string[],
	messages: Message[],
	metadata: {
		provider: string;
		model: string;
		setMessages?: (messages: Message[]) => void;
		client?: LLMClient | null;
	},
): Promise<React.ReactElement> {
	try {
		const manager = getDefaultCheckpointManager();
		const checkpointName = args.join(' ');

		if (checkpointName) {
			if (!manager.checkpointExists(checkpointName)) {
				return errorMsg(
					`Checkpoint '${checkpointName}' does not exist. Use /checkpoint list to see available checkpoints.`,
					'error',
				);
			}

			const checkpointData = await manager.loadCheckpoint(checkpointName, {
				validateIntegrity: true,
			});

			const gaps = await manager.restoreFiles(checkpointData);

			await restoreCheckpointConversation(checkpointData.conversation.messages, {
				setMessages: metadata.setMessages,
				client: metadata.client,
			});

			return React.createElement(
				React.Fragment,
				{key: generateKey('load-success')},
				React.createElement(SuccessMessage, {
					key: 'success',
					message: `✓ Checkpoint '${checkpointName}' restored successfully`,
					hideBox: true,
				}),
				React.createElement(InfoMessage, {
					key: 'details',
					message: `Restored checkpoint:
  • ${checkpointData.fileSnapshots.size} file(s) restored to workspace
  • ${checkpointData.conversation.messages.length} message(s) restored to conversation
  • Provider: ${checkpointData.metadata.provider.name} (${
		checkpointData.metadata.provider.model
	})
  • Created: ${new Date(checkpointData.metadata.timestamp).toLocaleString()}`,
					hideBox: true,
				}),
				gaps.length > 0
					? React.createElement(WarningMessage, {
							key: 'gaps',
							message: describeGapsMessage(gaps),
							hideBox: true,
						})
					: null,
			);
		}

		const checkpoints = await manager.listCheckpoints();

		if (checkpoints.length === 0) {
			return infoMsg(
				'No checkpoints available. Create one with /checkpoint create [name]',
				'info',
			);
		}

		const CheckpointSelector = (
			await import('@/components/checkpoint-selector')
		).default;

		const handleError = (error: Error) => {
			addToMessageQueue(
				errorMsg(
					`Failed to restore checkpoint: ${error.message}`,
					'restore-error',
				),
			);
		};

		return React.createElement(CheckpointSelector, {
			key: generateKey('selector'),
			checkpoints,
			currentMessageCount: messages.length,
			onSelect: (selectedName: string, createBackup: boolean) => {
				void (async () => {
					try {
						if (createBackup) {
							try {
								await manager.saveCheckpoint(
									`backup-${new Date().toISOString().replace(/[:.]/g, '-')}`,
									messages,
									metadata.provider,
									metadata.model,
								);
							} catch (error) {
								// Show backup error but continue with restore
								addToMessageQueue(
									warningMsg(
										`Warning: Failed to create backup: ${formatError(error)}`,
										'backup-warning',
									),
								);
							}
						}

						const checkpointData = await manager.loadCheckpoint(selectedName, {
							validateIntegrity: true,
						});

						const gaps = await manager.restoreFiles(checkpointData);

						await restoreCheckpointConversation(
							checkpointData.conversation.messages,
							{
								setMessages: metadata.setMessages,
								client: metadata.client,
							},
						);

						addToMessageQueue(
							successMsg(
								`✓ Checkpoint '${selectedName}' restored successfully`,
								'restore-success',
							),
						);

						if (gaps.length > 0) {
							addToMessageQueue(
								warningMsg(describeGapsMessage(gaps), 'restore-gaps'),
							);
						}
					} catch (error) {
						handleError(
							error instanceof Error ? error : new Error('Unknown error'),
						);
					}
				})();
			},
			onCancel: () => {
				// Nothing to do, component will unmount
			},
			onError: handleError,
		});
	} catch (error) {
		return errorMsg(
			`Failed to load checkpoint: ${formatError(error)}`,
			'error',
		);
	}
}

/**
 * Delete checkpoint subcommand
 */
async function deleteCheckpoint(args: string[]): Promise<React.ReactElement> {
	try {
		if (args.length === 0) {
			return errorMsg(
				'Please specify a checkpoint name to delete. Usage: /checkpoint delete <name>',
				'error',
			);
		}

		const manager = getDefaultCheckpointManager();
		const checkpointName = args.join(' ');

		if (!manager.checkpointExists(checkpointName)) {
			return errorMsg(
				`Checkpoint '${checkpointName}' does not exist. Use /checkpoint list to see available checkpoints.`,
				'error',
			);
		}

		// Actually delete the checkpoint
		await manager.deleteCheckpoint(checkpointName);

		// Show success with what was deleted
		return successMsg(
			`✓ Checkpoint '${checkpointName}' deleted successfully`,
			'delete-success',
		);
	} catch (error) {
		return errorMsg(
			`Failed to delete checkpoint: ${formatError(error)}`,
			'error',
		);
	}
}

/**
 * Main checkpoint command handler
 */
export const checkpointCommand: Command = {
	name: 'checkpoint',
	description:
		'Manage conversation checkpoints - save and restore session snapshots',
	handler: async (args: string[], messages: Message[], metadata) => {
		if (args.length === 0) {
			return checkpointCommand.handler(['help'], messages, metadata);
		}

		const subcommand = args[0].toLowerCase();
		const subArgs = args.slice(1);

		switch (subcommand) {
			case 'create':
			case 'save':
				return await createCheckpoint(subArgs, messages, metadata);

			case 'list':
			case 'ls':
				return await listCheckpoints();

			case 'load':
			case 'restore':
				return await loadCheckpoint(subArgs, messages, metadata);

			case 'delete':
			case 'remove':
			case 'rm':
				return await deleteCheckpoint(subArgs);

			case 'help':
			case '--help':
			case '-h':
				return React.createElement(CheckpointHelp, {
					key: generateKey('help'),
				});

			default:
				return errorMsg(
					`Unknown checkpoint subcommand: ${subcommand}. Use /checkpoint help for available commands.`,
					'error',
				);
		}
	},
};
