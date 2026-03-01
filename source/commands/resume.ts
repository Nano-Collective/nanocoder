import React from 'react';
import {InfoMessage} from '@/components/message-box';
import type {Command} from '@/types/commands';
import type {Message} from '@/types/core';

/**
 * Resume command. Actual handling is done in app-util (handleResumeCommand)
 * so that session selector and resume-by-id/last/index can update app state.
 * This handler is used when the command is invoked via the registry (e.g. help).
 */
export const resumeCommand: Command = {
	name: 'resume',
	description:
		'List and resume previous chat sessions. Aliases: /sessions, /history',
	handler: async (_args: string[], _messages: Message[], _metadata) => {
		return React.createElement(InfoMessage, {
			key: `resume-help-${Date.now()}`,
			message: `Resume a previous session:
  /resume          - Show session list (↑/↓ select, Enter resume)
  /resume last    - Resume most recent session
  /resume <id>    - Resume by session ID
  /resume <n>     - Resume by list index (e.g. /resume 1)

Aliases: /sessions, /history`,
			hideBox: true,
		});
	},
};
