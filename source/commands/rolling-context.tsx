import {Box, Text} from 'ink';
import React from 'react';
import {SuccessMessage} from '@/components/message-box';
import {
	getContextManagementConfig,
	getRollingContextEnabled,
	setRollingContextEnabled,
} from '@/config/preferences';
import {Command} from '@/types/index';

interface RollingContextToggleProps {
	enabled: boolean;
	config: ReturnType<typeof getContextManagementConfig>;
}

function RollingContextToggle({enabled, config}: RollingContextToggleProps) {
	return (
		<Box flexDirection="column">
			<SuccessMessage
				hideBox={true}
				message={`Rolling context ${enabled ? 'enabled' : 'disabled'}.`}
			/>
			{enabled && (
				<Box flexDirection="column" marginTop={1}>
					<Text dimColor>
						Max context: {config.maxContextTokens.toLocaleString()} tokens
					</Text>
					<Text dimColor>
						Reserved for output: {config.reservedOutputTokens.toLocaleString()}{' '}
						tokens
					</Text>
					<Text dimColor>
						Max input:{' '}
						{(
							config.maxContextTokens - config.reservedOutputTokens
						).toLocaleString()}{' '}
						tokens
					</Text>
					<Text dimColor>Strategy: {config.trimStrategy}</Text>
				</Box>
			)}
		</Box>
	);
}

export const rollingContextCommand: Command = {
	name: 'rolling-context',
	description: 'Toggle rolling context management (prevents context overflow)',
	handler: async (args: string[]) => {
		const arg = args[0]?.toLowerCase();
		let newState: boolean;

		if (arg === 'on' || arg === 'enable') {
			newState = true;
		} else if (arg === 'off' || arg === 'disable') {
			newState = false;
		} else if (arg === 'status') {
			// Show current status without changing
			const enabled = getRollingContextEnabled();
			const config = getContextManagementConfig();
			return React.createElement(RollingContextToggle, {
				key: `rolling-context-status-${Date.now()}`,
				enabled,
				config,
			});
		} else {
			// Toggle current state
			newState = !getRollingContextEnabled();
		}

		setRollingContextEnabled(newState);
		const config = getContextManagementConfig();

		return React.createElement(RollingContextToggle, {
			key: `rolling-context-${Date.now()}`,
			enabled: newState,
			config,
		});
	},
};
