import {MAX_SESSION_NAME_LENGTH} from '@/constants';
import type {StatefulCommand} from '@/types/index';
import {errorMsg, successMsg} from '@/utils/message-factory';

export const renameCommand: StatefulCommand = {
	name: 'rename',
	description: 'Rename the current session (/rename <new name>)',
	run: async context => {
		const newName = context.args.join(' ').trim();
		if (!newName) {
			context.addToChatQueue(
				errorMsg('Usage: /rename <session name>', 'rename-error'),
			);
		} else if (newName.length > MAX_SESSION_NAME_LENGTH) {
			context.addToChatQueue(
				errorMsg(
					`Session name must be ${MAX_SESSION_NAME_LENGTH} characters or less.`,
					'rename-error',
				),
			);
		} else {
			context.renameSession(newName);
			context.addToChatQueue(
				successMsg(`Session renamed to "${newName}".`, 'rename-success'),
			);
		}
		return 'done-after-render';
	},
};
