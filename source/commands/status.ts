import type {StatefulCommand} from '@/types/index';

export const statusCommand: StatefulCommand = {
	name: 'status',
	description: 'Display current status (provider, model, theme)',
	run: async context => {
		context.showStatus();
		return 'done-after-render';
	},
};
