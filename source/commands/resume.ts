import {resolveSession} from '@/session/resolve-session';
import {sessionManager} from '@/session/session-manager';
import type {StatefulCommand} from '@/types/index';
import {formatError} from '@/utils/error-formatter';
import {errorMsg, infoMsg} from '@/utils/message-factory';

/**
 * /resume (also /sessions and /history, see `aliases.ts`). No args: show the
 * session selector. One arg: resume by "last", id, or list index.
 */
export const resumeCommand: StatefulCommand = {
	name: 'resume',
	description:
		'List and resume previous chat sessions. Aliases: /sessions, /history',
	run: async context => {
		const {addToChatQueue, enterSessionSelectorMode, resumeSession} = context;

		if (!enterSessionSelectorMode || !resumeSession) {
			addToChatQueue(
				errorMsg(
					'Session management is not available in this context.',
					'resume-error',
				),
			);
			return 'done';
		}

		const trimmed = context.argText.trim();
		const rawArgs = trimmed ? trimmed.split(/\s+/) : [];
		const showAll = rawArgs.includes('--all');
		const args = rawArgs.filter(a => a !== '--all');

		try {
			await sessionManager.initialize();
		} catch (error) {
			addToChatQueue(
				errorMsg(
					`Failed to initialize sessions: ${formatError(error)}`,
					'resume-error',
				),
			);
			return 'done';
		}

		if (args.length === 0) {
			enterSessionSelectorMode(showAll || undefined);
			return 'done';
		}

		try {
			const result = await resolveSession(args[0], process.cwd(), {
				all: showAll,
			});

			if (!result.ok) {
				addToChatQueue(
					result.reason === 'empty'
						? infoMsg(result.message, 'resume-info')
						: errorMsg(result.message, 'resume-error'),
				);
				return 'done';
			}

			// Awaited so the command only completes once the client has switched
			// to the session's provider and model; a queued prompt waits for it.
			await resumeSession(result.session);
		} catch (error) {
			addToChatQueue(
				errorMsg(
					`Failed to resume session: ${formatError(error)}`,
					'resume-error',
				),
			);
		}

		return 'done';
	},
};
