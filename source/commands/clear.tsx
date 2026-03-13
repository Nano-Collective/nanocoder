import React from 'react';
import {SuccessMessage} from '@/components/message-box';
import {clearAllTasks} from '@/tools/tasks';
import {Command} from '@/types/index';

function Clear() {
	return (
		<SuccessMessage
			hideBox={true}
			message="Chat and tasks cleared."
		></SuccessMessage>
	);
}

export const clearCommand: Command = {
	name: 'clear',
	description: 'Clear the chat history, model context, and tasks',
	handler: async (_args: string[]) => {
		// Clear all tasks
		await clearAllTasks();

		// Return info message saying chat was cleared
		return React.createElement(Clear, {
			key: `clear-${Date.now()}`,
		});
	},
};
