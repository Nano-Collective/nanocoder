import React from 'react';
import {
	errorMsg,
	infoMsg,
	successMsg,
	warningMsg,
} from '@/components/message-factory';
import RewindPicker from '@/components/rewind-picker';
import {
	getSessionTimeline,
	listRewindPoints,
	messagesAfterRewind,
	promptTitle,
	type RewindMode,
	type RewindPoint,
	restoreConversation,
	restoreFiles,
} from '@/services/rewind';
import type {CommandContext, StatefulCommand} from '@/types/index';
import {prefillComposer} from '@/utils/composer-draft';
import {formatError} from '@/utils/error-formatter';
import {generateKey} from '@/utils/key-generator';

/**
 * Restore the workspace and/or the conversation to just before `point`, then
 * hand the prompt back to the composer.
 *
 * Files first: `restoreFiles` also drops the timeline entries of the prompt and
 * later ones, so a failure there leaves the conversation untouched rather than
 * two records disagreeing about what is on disk. `restoreConversation` is only
 * needed for the conversation-only mode; in the combined mode the file restore
 * has already discarded those entries.
 */
async function applyRewind(
	timeline: NonNullable<ReturnType<typeof getSessionTimeline>>,
	point: RewindPoint,
	mode: RewindMode,
	messages: CommandContext['messages'],
	context: CommandContext,
): Promise<void> {
	let filesRestored: string[] = [];

	try {
		if (mode !== 'conversation') {
			filesRestored = await restoreFiles(timeline, point);
		}

		if (mode !== 'files') {
			const kept = messagesAfterRewind(messages, point);
			context.setMessages(kept);
			if (mode === 'conversation') {
				await restoreConversation(timeline, point);
			}
			prefillComposer(point.promptText);
		}

		const parts: string[] = [];
		if (mode !== 'conversation') {
			parts.push(`${filesRestored.length} file(s) restored`);
		}
		if (mode !== 'files') {
			parts.push(
				`${Math.max(0, messages.length - point.messageIndex)} message(s) removed`,
			);
		}

		context.addToChatQueue(
			successMsg(
				`✓ Rewound to before "${promptTitle(point.promptText) || '(empty prompt)'}": ${parts.join(', ')}${
					mode !== 'files' ? '. The prompt is back in the input.' : ''
				}`,
				'rewind-success',
			),
		);

		if (mode !== 'conversation' && filesRestored.length > 0) {
			context.addToChatQueue(
				warningMsg(
					'Bash side effects from the undone turn are not reverted.',
					'rewind-bash-note',
				),
			);
		}
	} catch (error) {
		context.addToChatQueue(
			errorMsg(`Rewind failed: ${formatError(error)}`, 'rewind-error'),
		);
	}
}

export const rewindCommand: StatefulCommand = {
	name: 'rewind',
	description:
		'Restore files and conversation to before an earlier prompt, with the prompt back in the input',
	run: async context => {
		const sessionId = context.handlerMetadata().sessionId;
		if (!sessionId) {
			context.addToChatQueue(
				errorMsg(
					'Rewind needs a session. Start chatting first.',
					'rewind-error',
				),
			);
			return 'done';
		}

		const timeline = getSessionTimeline(sessionId);
		if (!timeline) {
			context.addToChatQueue(
				errorMsg(
					'Rewind is unavailable in this workspace: its timeline could not be opened.',
					'rewind-error',
				),
			);
			return 'done';
		}

		let points: RewindPoint[];
		try {
			points = await listRewindPoints(timeline);
		} catch (error) {
			context.addToChatQueue(
				errorMsg(
					`Could not read the timeline: ${formatError(error)}`,
					'rewind-error',
				),
			);
			return 'done';
		}

		if (points.length === 0) {
			context.addToChatQueue(
				infoMsg(
					'No prompts to rewind to yet. Prompts are recorded as they are sent, from the version of Nanocoder that has /rewind.',
					'rewind-info',
				),
			);
			return 'done';
		}

		context.setLiveComponentCapturesInput(true);

		const until = new Promise<void>(resolve => {
			const close = () => {
				context.setLiveComponent(null);
				context.setLiveComponentCapturesInput(false);
				resolve();
			};

			context.setLiveComponent(
				React.createElement(RewindPicker, {
					key: generateKey('rewind-picker'),
					points,
					currentMessageCount: context.messages.length,
					onCancel: close,
					onSelect: (point: RewindPoint, mode: RewindMode) => {
						void (async () => {
							try {
								await applyRewind(
									timeline,
									point,
									mode,
									context.messages,
									context,
								);
							} finally {
								close();
							}
						})();
					},
				}),
			);
		});

		return {until};
	},
};
