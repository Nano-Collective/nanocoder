import React from 'react';
import {sessionManager} from '@/session/session-manager';
import type {Command} from '@/types/commands';
import type {Message} from '@/types/core';

export const resumeCommand: Command = {
	name: 'resume',
	description: 'Resume a previous chat session',
	handler: async (args: string[], _messages: Message[], _metadata) => {
		// Initialize session manager
		try {
			await sessionManager.initialize();
		} catch (_error) {
			return React.createElement(
				'div',
				null,
				'Failed to initialize session manager',
			);
		}

		// If a session ID was provided as an argument, try to load it directly
		if (args.length > 0) {
			const sessionIdOrIndex = args[0];

			// Handle special cases
			if (sessionIdOrIndex === 'last') {
				const sessions = await sessionManager.listSessions();
				if (sessions.length > 0) {
					// Sort by lastAccessedAt descending and get the first (most recent)
					const sortedSessions = sessions.sort(
						(a, b) =>
							new Date(b.lastAccessedAt).getTime() -
							new Date(a.lastAccessedAt).getTime(),
					);
					const lastSession = sortedSessions[0];

					try {
						const session = await sessionManager.loadSession(lastSession.id);
						if (session) {
							// Return metadata in a way that can be handled by the app
							return React.createElement(
								'div',
								null,
								`To resume session "${session.title}", you'll need to manually restore the messages, provider (${session.provider}), and model (${session.model}).`,
							);
						}
					} catch (_error) {
						return React.createElement('div', null, 'Failed to load session');
					}
				}
				return React.createElement('div', null, 'No sessions found');
			}

			// Try to parse as index
			const index = parseInt(sessionIdOrIndex, 10);
			if (!isNaN(index)) {
				const sessions = await sessionManager.listSessions();
				if (index > 0 && index <= sessions.length) {
					const sessionMetadata = sessions[index - 1];
					try {
						const session = await sessionManager.loadSession(
							sessionMetadata.id,
						);
						if (session) {
							return React.createElement(
								'div',
								null,
								`To resume session "${session.title}", you'll need to manually restore the messages, provider (${session.provider}), and model (${session.model}).`,
							);
						}
					} catch (_error) {
						return React.createElement('div', null, 'Failed to load session');
					}
				}
				return React.createElement(
					'div',
					null,
					`Invalid session index: ${index}`,
				);
			}

			// Treat as session ID
			try {
				const session = await sessionManager.loadSession(sessionIdOrIndex);
				if (session) {
					return React.createElement(
						'div',
						null,
						`To resume session "${session.title}", you'll need to manually restore the messages, provider (${session.provider}), and model (${session.model}).`,
					);
				}
				return React.createElement(
					'div',
					null,
					`Session not found: ${sessionIdOrIndex}`,
				);
			} catch (_error) {
				return React.createElement('div', null, 'Failed to load session');
			}
		}

		// No arguments - show instructions
		return React.createElement(
			'div',
			null,
			'Session management is available. Use:\n' +
				'  /resume [id] - Resume specific session\n' +
				'  /resume [number] - Resume by list index\n' +
				'  /resume last - Resume most recent session\n' +
				'\nNote: Manual restoration of session context is currently required.',
		);
	},
};
