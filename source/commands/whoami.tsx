import {Box, Text} from 'ink';
import {loadProviderConfigs} from '@/client-factory';
import type {Command} from '@/types/index';

export function maskApiKey(key?: string): string {
	if (!key || key === 'dummy-key') return 'Not set';
	if (key.length <= 8) return '********';
	const start = key.substring(0, 4);
	const end = key.substring(key.length - 4);
	return `${start}...${end}`;
}

export const whoamiCommand: Command = {
	name: 'whoami',
	description: 'Show active provider configuration, API keys, and base URLs',
	handler: (_args, _messages, metadata) => {
		const providers = loadProviderConfigs();
		const currentProvider = providers.find(p => p.name === metadata.provider);

		if (!currentProvider) {
			return Promise.resolve(
				<Box flexDirection="column" paddingY={1} paddingX={2}>
					<Text color="red">Unknown provider: {metadata.provider}</Text>
				</Box>,
			);
		}

		return Promise.resolve(
			<Box
				flexDirection="column"
				paddingY={1}
				paddingX={2}
				borderStyle="round"
				borderColor="blue"
			>
				<Text bold>Active Configuration</Text>
				<Text>Provider: {metadata.provider}</Text>
				<Text>Model: {metadata.model}</Text>
				{currentProvider.config.baseURL && (
					<Text>Base URL: {currentProvider.config.baseURL}</Text>
				)}
				<Text>API Key: {maskApiKey(currentProvider.config.apiKey)}</Text>
			</Box>,
		);
	},
};

export const authCommand: Command = {
	...whoamiCommand,
	name: 'auth',
};
