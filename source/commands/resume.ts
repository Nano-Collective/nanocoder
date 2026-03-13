import type {Command} from '@/types/commands';

/**
 * Resume command registration for /help listing.
 * Actual handling is done in app-util.ts (handleResumeCommand) which
 * intercepts /resume, /sessions, and /history before the registry runs.
 */
export const resumeCommand: Command = {
	name: 'resume',
	description:
		'List and resume previous chat sessions. Aliases: /sessions, /history',
	handler: async () => {},
};
