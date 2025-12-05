import {Command} from '@/types/index';
import React from 'react';
import InfoMessage from '@/components/info-message';
import {isDebuggingEnabled, setDebuggingEnabled} from '@/config/preferences';
import {Box} from 'ink';

function DebuggingToggle({enabled}: {enabled: boolean}) {
	return (
		<Box marginTop={1} marginBottom={1}>
			<InfoMessage
				hideBox={true}
				message={`Tool execution debugging ${
					enabled ? 'enabled' : 'disabled'
				}.`}
			/>
		</Box>
	);
}

export const debuggingCommand: Command = {
	name: 'debugging',
	description: 'Toggle tool execution debugging logs on/off',
	handler: (_args: string[]) => {
		// Toggle the current debugging setting
		const currentSetting = isDebuggingEnabled();
		const newSetting = !currentSetting;
		setDebuggingEnabled(newSetting);

		return Promise.resolve(
			React.createElement(DebuggingToggle, {
				enabled: newSetting,
				key: `debugging-${Date.now()}`,
			}),
		);
	},
};
