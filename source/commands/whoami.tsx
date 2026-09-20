import {Box, Text} from 'ink';
import React from 'react';
import {loadProviderConfigs} from '@/client-factory';
import {loadCodexCredential} from '@/config/codex-credentials';
import {loadCopilotCredential} from '@/config/copilot-credentials';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {generateKey} from '@/session/key-generator';
import {isLocalURL} from '@/utils/url-utils';
import type {Command} from '@/types/index';
import type {AIProviderConfig} from '@/types/config';

/**
 * Mask an API key for display. Strict middle-hiding: only a fixed-width
 * hint of the key is ever shown, so screenshots stay safe and the mask
 * does not disclose the key length.
 */
export function maskApiKey(key?: string): string {
	if (!key || key === 'dummy-key') return 'Not set';
	if (key.length <= 12) return '********';
	return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
}

/**
 * Human-readable credential status for the active provider:
 * - device-flow providers (Copilot, ChatGPT/Codex) authenticate through
 *   stored credentials, not API keys - show whether those exist;
 * - local servers (Ollama etc.) need no key at all;
 * - hosted providers show a masked API key.
 */
export function describeCredentials(provider: AIProviderConfig): string {
	if (provider.sdkProvider === 'github-copilot') {
		const credential = loadCopilotCredential(provider.name);
		return credential?.oauthToken ? 'Logged in (device flow)' : 'Not logged in';
	}
	if (provider.sdkProvider === 'chatgpt-codex') {
		const credential = loadCodexCredential(provider.name);
		return credential?.accessToken ? 'Logged in (device flow)' : 'Not logged in';
	}
	const baseURL = provider.config.baseURL;
	if (!provider.config.apiKey && baseURL && isLocalURL(baseURL)) {
		return 'Not required (local)';
	}
	return maskApiKey(provider.config.apiKey);
}

interface WhoamiProps {
	provider: string;
	model: string;
	baseURL?: string;
	credentials: string;
}

export function Whoami({provider, model, baseURL, credentials}: WhoamiProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	return (
		<TitledBoxWithPreferences
			title="/whoami"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Text color={colors.text} bold>
				Active Configuration
			</Text>
			<Text color={colors.text}>Provider: {provider}</Text>
			<Text color={colors.text}>Model: {model}</Text>
			{baseURL && <Text color={colors.text}>Base URL: {baseURL}</Text>}
			<Text color={colors.text}>Credentials: {credentials}</Text>
			<Text color={colors.secondary}>
				See /status for theme and model details, /doctor for provider
				health and configured base URLs.
			</Text>
		</TitledBoxWithPreferences>
	);
}

export const whoamiCommand: Command = {
	name: 'whoami',
	description: 'Show active provider, model and credential status',
	handler: async (_args: string[], _messages, metadata) => {
		const providers = loadProviderConfigs();
		// Provider lookup is case-insensitive, mirroring resolveProviderName
		// (metadata.provider can come from a restored session).
		const currentProvider = providers.find(
			p => p.name.toLowerCase() === metadata.provider?.toLowerCase(),
		);

		if (!currentProvider) {
			return React.createElement(
				Box,
				{flexDirection: 'column', paddingY: 1, paddingX: 2, key: generateKey('whoami')},
				React.createElement(
					Text,
					{color: 'red'},
					`Unknown provider: ${metadata.provider}`,
				),
			);
		}

		return React.createElement(Whoami, {
			key: generateKey('whoami'),
			provider: metadata.provider,
			model: metadata.model,
			baseURL: currentProvider.config.baseURL,
			credentials: describeCredentials(currentProvider),
		});
	},
};

/** Alias of /whoami: authenticate-only users look for "auth" first. */
export const authCommand: Command = {
	...whoamiCommand,
	name: 'auth',
	description: 'Alias for /whoami',
};
