import React from 'react';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import {sessionManager} from '@/session/session-manager';
import type {MessageSubmissionOptions} from '@/types/index';

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
		getNextComponentKey,
	} = options;

	if (!onEnterSessionSelectorMode || !onResumeSession) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `resume-error-${getNextComponentKey()}`,
				message: 'Session management is not available in this context.',
				hideBox: true,
			}),
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
			React.createElement(ErrorMessage, {
				key: `resume-error-${getNextComponentKey()}`,
				message: `Failed to initialize sessions: ${error instanceof Error ? error.message : 'Unknown error'}`,
				hideBox: true,
			}),
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
		const listOptions = showAll ? undefined : {workingDirectory: process.cwd()};
		const sessions = await sessionManager.listSessions(listOptions);
		const sorted = [...sessions].sort(
			(a, b) =>
				new Date(b.lastAccessedAt).getTime() -
				new Date(a.lastAccessedAt).getTime(),
		);

		let sessionId: string | null = null;

		if (sessionIdOrSpecial.toLowerCase() === 'last') {
			if (sorted.length > 0) sessionId = sorted[0].id;
		} else {
			const index = Number.parseInt(sessionIdOrSpecial, 10);
			if (!Number.isNaN(index) && index >= 1 && index <= sorted.length) {
				sessionId = sorted[index - 1].id;
			} else {
				sessionId = sessionIdOrSpecial;
			}
		}

		if (!sessionId) {
			onAddToChatQueue(
				React.createElement(InfoMessage, {
					key: `resume-info-${getNextComponentKey()}`,
					message: 'No sessions found.',
					hideBox: true,
				}),
			);
			onCommandComplete?.();
			return true;
		}

		const session = await sessionManager.loadSession(sessionId);
		if (session) {
			onResumeSession(session);
		} else {
			onAddToChatQueue(
				React.createElement(ErrorMessage, {
					key: `resume-error-${getNextComponentKey()}`,
					message: `Session not found: ${sessionId}`,
					hideBox: true,
				}),
			);
		}
	} catch (error) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `resume-error-${getNextComponentKey()}`,
				message: `Failed to resume session: ${error instanceof Error ? error.message : 'Unknown error'}`,
				hideBox: true,
			}),
		);
	}

	onCommandComplete?.();
	return true;
}
