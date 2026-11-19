import {sharedProposalStore} from '@/memory/proposal-store';
import type {StatefulCommand} from '@/types/index';

export const clearCommand: StatefulCommand = {
	name: 'clear',
	description: 'Clear the chat history, model context, and tasks',
	run: async context => {
		await context.clearMessages();
		// Memory proposals belong to the conversation being cleared.
		sharedProposalStore.clear();
		context.notifyCleared();
		return 'done-after-render';
	},
};
