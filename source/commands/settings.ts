import {createStubCommand} from '@/commands/create-stub-command';

export const settingsCommand = createStubCommand(
	'settings',
	'Configure settings by tab (appearance, input, behavior, providers, mcp, advanced). Accepts a tab: /settings providers',
);
