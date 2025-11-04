import React from 'react';
import { Command } from '@/types/index';
import { Message } from '@/types/core';

export const resumeCommand: Command = {
	name: 'resume',
	description: 'Resume a previous chat session',
	handler: (_args: string[], _messages: Message[], _metadata: {provider: string; model: string; tokens: number}) => {
		// This command is handled specially in app.tsx
		// This handler exists only for registration purposes
		return Promise.resolve(React.createElement(React.Fragment));
	},
};