import type {StatefulCommand} from '@/types/index';

export const explorerCommand: StatefulCommand = {
	name: 'explorer',
	description: 'Browse project files and add to context',
	run: async context => {
		context.enterExplorerMode();
		return 'done';
	},
};
