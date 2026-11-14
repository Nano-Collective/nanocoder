import crypto from 'node:crypto';
import {isInternalWalkthroughMessage} from '@/artifacts/walkthrough-lifecycle';
import {errorMsg, infoMsg} from '@/components/message-factory';
import {MAX_SESSION_NAME_LENGTH} from '@/constants';
import {deriveSessionTitle} from '@/hooks/useSessionAutosave';
import {sessionManager} from '@/session/session-manager';
import type {Message} from '@/types/core';
import type {StatefulCommand} from '@/types/index';
import {formatError} from '@/utils/error-formatter';

/**
 * Persist the live conversation before forking it.
 *
 * Autosave is debounced (30s by default), so the session on disk can lag
 * behind the conversation. Forking without flushing would branch from a
 * stale transcript and leave the original missing the latest turns. The
 * autosave path itself is left alone: this is a one-off explicit save.
 */
async function saveConversationForFork(
	sessionId: string,
	messages: Message[],
	provider: string,
	model: string,
): Promise<void> {
	const existing = await sessionManager.readSession(sessionId);
	if (!existing) {
		await sessionManager.createSession({
			id: sessionId,
			title: deriveSessionTitle(messages),
			messageCount: messages.length,
			provider,
			model,
			workingDirectory: process.cwd(),
			messages,
		});
		return;
	}

	const updated = {
		...existing,
		messages,
		messageCount: messages.length,
		provider,
		model,
		lastAccessedAt: new Date().toISOString(),
	};
	// Matches autosave: a manual rename or a generated title sticks.
	if (!existing.titleManuallySet && !existing.titleGenerated) {
		updated.title = deriveSessionTitle(messages);
	}
	await sessionManager.saveSession(updated);
}

/**
 * /fork [title]: copy the current conversation into a new session and switch
 * to it, leaving the original untouched and available in /resume.
 */
export const forkCommand: StatefulCommand = {
	name: 'fork',
	description:
		'Copy the current conversation into a new session (/fork [title])',
	run: async context => {
		const {addToChatQueue, resumeSession} = context;

		if (!resumeSession) {
			addToChatQueue(
				errorMsg(
					'Session management is not available in this context.',
					'fork-error',
				),
			);
			return 'done';
		}

		const requestedTitle = context.argText.trim();
		if (requestedTitle.length > MAX_SESSION_NAME_LENGTH) {
			addToChatQueue(
				errorMsg(
					`Session name must be ${MAX_SESSION_NAME_LENGTH} characters or less.`,
					'fork-error',
				),
			);
			return 'done';
		}

		// The walkthrough nudge is in-loop plumbing, not conversation. Autosave
		// keeps it out of session files; a fork must not replay it either.
		const messages = context.messages.filter(
			message => !isInternalWalkthroughMessage(message),
		);
		if (messages.length === 0) {
			addToChatQueue(
				infoMsg(
					'Nothing to fork yet — start a conversation first.',
					'fork-info',
				),
			);
			return 'done';
		}

		try {
			await sessionManager.initialize();

			// Every submission preallocates an id, but fall back to one rather than
			// refusing to fork if a caller drives this command directly.
			const parentId =
				context.handlerMetadata().sessionId ?? crypto.randomUUID();
			await saveConversationForFork(
				parentId,
				messages,
				context.provider,
				context.model,
			);

			const forked = await sessionManager.forkSession(parentId, {
				title: requestedTitle || undefined,
			});
			if (!forked) {
				addToChatQueue(
					errorMsg('Session to fork was not found.', 'fork-error'),
				);
				return 'done';
			}

			await resumeSession(forked, 'fork');
		} catch (error) {
			addToChatQueue(
				errorMsg(`Failed to fork session: ${formatError(error)}`, 'fork-error'),
			);
		}

		return 'done';
	},
};
