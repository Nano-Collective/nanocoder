import {Box, Text} from 'ink';
import React from 'react';
import {loadProviderConfigs} from '@/client-factory';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {generateKey} from '@/session/key-generator';
import type {AIProviderConfig, Command} from '@/types/index';

/** What `loadProviderConfigs` puts in `apiKey` when the provider has none. */
const NO_KEY_PLACEHOLDER = 'dummy-key';

/** Keys shorter than this are masked entirely; revealing 7 characters of a short key gives too much away. */
const MIN_REVEAL_LENGTH = 20;

export interface WhoamiInfo {
	provider: string;
	model: string;
	baseURL: string;
	apiKey: string;
}

/** Keep the start and end of a long key and hide the middle, so a screenshot cannot leak it. */
export function maskApiKey(key: string): string {
	if (key.length < MIN_REVEAL_LENGTH) return '********';
	return `${key.slice(0, 3)}...${key.slice(-4)}`;
}

/** The active provider's identity. Only masked or descriptive values come back, never a raw key. */
export function collectWhoami(
	provider: string,
	model: string,
	providers: AIProviderConfig[],
): WhoamiInfo {
	const config = providers.find(p => p.name === provider);
	if (!config) {
		return {
			provider: provider || 'none',
			model: model || 'none',
			baseURL: 'unknown',
			apiKey: 'unknown (provider not found in config)',
		};
	}

	const {apiKey, baseURL} = config.config;
	const usesOAuth =
		config.sdkProvider === 'chatgpt-codex' ||
		config.sdkProvider === 'github-copilot';

	return {
		provider: config.name,
		model: model || 'none',
		// Drop any user:password@ from the URL so it cannot leak either.
		baseURL: baseURL
			? baseURL.replace(/\/\/[^/@]*@/, '//')
			: 'provider default',
		apiKey: usesOAuth
			? 'OAuth login (no API key)'
			: apiKey && apiKey !== NO_KEY_PLACEHOLDER
				? maskApiKey(apiKey)
				: 'not set',
	};
}

export function Whoami({info}: {info: WhoamiInfo}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const rows: Array<[string, string]> = [
		['Provider', info.provider],
		['Model', info.model],
		['Base URL', info.baseURL],
		['API key', info.apiKey],
	];

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
			<Text color={colors.secondary}>
				The active provider configuration. API keys are masked.
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{rows.map(([label, value]) => (
					<Text key={label} color={colors.text}>
						<Text color={colors.primary} bold>
							{label.padEnd(10)}
						</Text>
						{value}
					</Text>
				))}
			</Box>
		</TitledBoxWithPreferences>
	);
}

export const whoamiCommand: Command = {
	name: 'whoami',
	description: 'Show the active provider, model, base URL, and masked API key',
	handler: async (_args, _messages, {provider, model}) =>
		React.createElement(Whoami, {
			key: generateKey('whoami'),
			info: collectWhoami(provider, model, loadProviderConfigs()),
		}),
};
