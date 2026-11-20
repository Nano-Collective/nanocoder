import type {StatefulCommand} from '@/types/index';

export const tuneCommand: StatefulCommand = {
	name: 'tune',
	description:
		'Tune model settings (parameters, tool profiles, prompt, compaction)',
	run: async context => {
		context.enterTune();
		return 'done';
	},
};
