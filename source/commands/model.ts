import type {StatefulCommand} from '@/types/index';

/** `/model browse` (formerly /model-database) opens the models.dev browser. */
const BROWSE_SUBCOMMAND = 'browse';

export const modelCommand: StatefulCommand = {
	name: 'model',
	description:
		"Select a model from any configured provider (/model browse to search OpenRouter's model list)",
	run: async context => {
		if (context.args[0]?.toLowerCase() === BROWSE_SUBCOMMAND) {
			context.enterModelDatabaseMode();
		} else {
			context.enterModelSelectionMode();
		}
		return 'done';
	},
};
