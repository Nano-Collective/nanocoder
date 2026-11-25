import {
	SETTINGS_TAB_IDS,
	type SettingsTabId,
} from '@/app/components/settings-constants';
import {errorMsg} from '@/components/message-factory';
import type {StatefulCommand} from '@/types/index';

function isSettingsTabId(value: string): value is SettingsTabId {
	return (SETTINGS_TAB_IDS as readonly string[]).includes(value);
}

export const settingsCommand: StatefulCommand = {
	name: 'settings',
	description:
		'Configure settings by tab (appearance, input, behavior, providers, mcp, advanced). Accepts a tab: /settings providers',
	run: async context => {
		const rawTab = context.args[0];
		const tabArg = rawTab?.toLowerCase();
		let tab: SettingsTabId | undefined;
		if (tabArg) {
			if (!isSettingsTabId(tabArg)) {
				context.addToChatQueue(
					errorMsg(
						`Unknown settings tab: "${rawTab}". Valid tabs: ${SETTINGS_TAB_IDS.join(', ')}`,
						'settings-error',
					),
				);
				return 'done-after-render';
			}
			tab = tabArg;
		}
		context.enterSettingsMode(tab);
		return 'done';
	},
};
