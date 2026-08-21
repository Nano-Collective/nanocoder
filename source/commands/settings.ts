import {createStubCommand} from '@/commands/create-stub-command';

export const settingsCommand = createStubCommand(
	'settings',
	'Configure settings (providers, MCP, theme, shapes, paste threshold). Accepts a tab: /settings providers',
);
