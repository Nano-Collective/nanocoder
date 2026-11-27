import {errorMsg, infoMsg} from '@/components/message-factory';
import {resolveSession} from '@/session/resolve-session';
import {sessionManager} from '@/session/session-manager';
import type {CommandContext, StatefulCommand} from '@/types/index';
import {formatError} from '@/utils/error-formatter';

/**
 * `/resume delete <id|index>` and `/resume pin <id|index>`. Both resolve the
 * target exactly like resuming does (including `--all`), but neither switches
 * the live conversation.
 */
async function runSessionAction(
	context: CommandContext,
	action: 'delete' | 'pin',
	target: string | undefined,
	showAll: boolean,
): Promise<void> {
	const {addToChatQueue, deleteSession, setSessionPinned} = context;
	if (!target) {
		addToChatQueue(
			errorMsg(`Usage: /resume ${action} <id|index>`, 'resume-error'),
		);
		return;
	}
	if (!deleteSession || !setSessionPinned) {
		addToChatQueue(
			errorMsg(
				'Session management is not available in this context.',
				'resume-error',
			),
		);
		return;
	}

	try {
		const result = await resolveSession(target, process.cwd(), {all: showAll});
		if (!result.ok) {
			addToChatQueue(
				result.reason === 'empty'
					? infoMsg(result.message, 'resume-info')
					: errorMsg(result.message, 'resume-error'),
			);
			return;
		}

		if (action === 'delete') {
			await deleteSession(result.session.id);
			addToChatQueue(
				infoMsg(`Deleted session: ${result.session.title}`, 'resume-info'),
			);
		} else {
			const pinned = !result.session.pinned;
			await setSessionPinned(result.session.id, pinned);
			addToChatQueue(
				infoMsg(
					`${pinned ? 'Pinned' : 'Unpinned'} session: ${result.session.title}`,
					'resume-info',
				),
			);
		}
	} catch (error) {
		addToChatQueue(
			errorMsg(
				`Failed to ${action} session: ${formatError(error)}`,
				'resume-error',
			),
		);
	}
}

/**
 * /resume (also /sessions and /history, see `aliases.ts`). No args: show the
 * session selector. One arg: resume by "last", id, or list index. The `delete`
 * and `pin` subcommands manage sessions instead of resuming them.
 */
export const resumeCommand: StatefulCommand = {
	name: 'resume',
	description:
		'List, resume, delete or pin chat sessions. Aliases: /sessions, /history',
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

		if (args[0] === 'delete' || args[0] === 'pin') {
			await runSessionAction(context, args[0], args[1], showAll);
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
