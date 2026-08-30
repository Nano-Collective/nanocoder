import {resolveSession} from '@/session/resolve-session';
import {sessionManager} from '@/session/session-manager';
import type {MessageSubmissionOptions} from '@/types/index';
import {formatError} from '@/utils/error-formatter';
import {errorMsg, infoMsg} from '@/utils/message-factory';

const RESUME_COMMANDS = ['resume', 'sessions', 'history'] as const;

function isResumeCommand(commandName: string): boolean {
	return RESUME_COMMANDS.includes(
		commandName.toLowerCase() as (typeof RESUME_COMMANDS)[number],
	);
}

/**
 * Handles /resume, /sessions, /history (session resume).
 * No args: show session selector. One arg: resume by "last", id, or list index.
 * Returns true if handled.
 */
export async function handleResumeCommand(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const commandName = commandParts[0]?.toLowerCase();
	if (!commandName || !isResumeCommand(commandName)) {
		return false;
	}

	const {
		onAddToChatQueue,
		onEnterSessionSelectorMode,
		onResumeSession,
		onCommandComplete,
	} = options;

	if (!onEnterSessionSelectorMode || !onResumeSession) {
		onAddToChatQueue(
			errorMsg(
				'Session management is not available in this context.',
				'resume-error',
			),
		);
		onCommandComplete?.();
		return true;
	}

	const rawArgs = commandParts.slice(1);
	const showAll = rawArgs.includes('--all');
	const args = rawArgs.filter(a => a !== '--all');

	try {
		await sessionManager.initialize();
	} catch (error) {
		onAddToChatQueue(
			errorMsg(
				`Failed to initialize sessions: ${formatError(error)}`,
				'resume-error',
			),
		);
		onCommandComplete?.();
		return true;
	}

	if (args.length === 0) {
		onEnterSessionSelectorMode(showAll || undefined);
		onCommandComplete?.();
		return true;
	}

	const sessionIdOrSpecial = args[0];
	try {
		const result = await resolveSession(sessionIdOrSpecial, process.cwd(), {
			all: showAll,
		});

		if (!result.ok) {
			const msg =
				result.reason === 'empty'
					? infoMsg(result.message, 'resume-info')
					: errorMsg(result.message, 'resume-error');
			onAddToChatQueue(msg);
			onCommandComplete?.();
			return true;
		}

		onResumeSession(result.session);
	} catch (error) {
		onAddToChatQueue(
			errorMsg(
				`Failed to resume session: ${formatError(error)}`,
				'resume-error',
			),
		);
	}

	onCommandComplete?.();
	return true;
}
