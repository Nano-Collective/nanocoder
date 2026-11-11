import type {StatefulCommand} from '@/types/index';

export const ideCommand: StatefulCommand = {
	name: 'ide',
	description: 'Connect to an IDE',
	run: async context => {
		context.enterIdeSelectionMode();
		return 'done';
	},
};
