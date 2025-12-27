import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {colors} from '@/config';
import {getConfigPath} from '@/config/paths';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {getLogger} from '@/utils/logging';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useRef, useState} from 'react';

export type ConfigLocation = 'project' | 'global';

interface LocationStepProps {
	onComplete: (location: ConfigLocation, path: string) => void;
	onBack?: () => void;
	projectDir: string;
}

interface LocationOption {
	label: string;
	value: ConfigLocation;
}

export function LocationStep({
	onComplete,
	onBack,
	projectDir,
}: LocationStepProps) {
	const logger = getLogger();
	const renderCountRef = useRef(0);
	renderCountRef.current += 1;

	logger.debug('LocationStep render', {
		renderCount: renderCountRef.current,
		projectDir,
	});

	const {isNarrow, truncatePath} = useResponsiveTerminal();
	const projectPath = join(projectDir, 'agents.config.json');
	const globalPath = join(getConfigPath(), 'agents.config.json');

	const projectExists = existsSync(projectPath);
	const globalExists = existsSync(globalPath);

	const [mode, setMode] = useState<
		'select-location' | 'existing-config' | null
	>(() => {
		// If project config exists, show existing config menu
		if (projectExists) {
			return 'existing-config';
		}
		// If global exists but project doesn't, still show location selection
		// but we'll note the global config exists
		return 'select-location';
	});

	const existingPath = projectExists ? projectPath : globalPath;

	const locationOptions: LocationOption[] = [
		{
			label: `Current project directory`,
			value: 'project',
		},
		{
			label: `Global user config`,
			value: 'global',
		},
	];

	const existingConfigOptions = [
		{label: 'Edit this configuration', value: 'edit'},
		{label: 'Create new config in different location', value: 'new'},
	];

	const handleLocationSelect = (item: LocationOption) => {
		logger.debug('LocationStep handleLocationSelect', {value: item.value});
		const path = item.value === 'project' ? projectPath : globalPath;
		onComplete(item.value, path);
	};

	const handleExistingConfigSelect = (item: {value: string}) => {
		logger.debug('LocationStep handleExistingConfigSelect', {
			value: item.value,
		});
		if (item.value === 'edit') {
			const location: ConfigLocation = projectExists ? 'project' : 'global';
			onComplete(location, existingPath);
		} else if (item.value === 'new') {
			setMode('select-location');
		} else {
			// Cancel
			onBack?.();
		}
	};

	// Handle Shift+Tab to go back from select-location to existing-config
	useInput((_input, key) => {
		if (key.shift && key.tab) {
			// If we're in select-location mode and came from existing-config, go back
			if (mode === 'select-location' && (projectExists || globalExists)) {
				setMode('existing-config');
			} else {
				// Otherwise, let the parent wizard handle it
				onBack?.();
			}
		}
	});

	if (mode === 'existing-config') {
		return (
			<Box flexDirection="column">
				<Box marginBottom={1} flexDirection="column">
					<Text bold color={colors.primary}>
						Configuration found at:{' '}
					</Text>
					<Text color={colors.secondary}>
						{isNarrow ? truncatePath(existingPath, 40) : existingPath}
					</Text>
				</Box>
				<SelectInput
					items={existingConfigOptions}
					onSelect={(item: {value: string}) => handleExistingConfigSelect(item)}
				/>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold color={colors.primary}>
					{isNarrow
						? 'Where to create config?'
						: 'Where would you like to create your configuration?'}
				</Text>
			</Box>
			{globalExists && !projectExists && (
				<Box marginBottom={1} flexDirection="column">
					<Text color={colors.warning}>
						{isNarrow
							? 'Note: Global config exists'
							: 'Note: Global config exists at'}
					</Text>
					{!isNarrow && <Text color={colors.secondary}>{globalPath}</Text>}
				</Box>
			)}
			<SelectInput
				items={locationOptions}
				onSelect={(item: LocationOption) => handleLocationSelect(item)}
			/>
			{!isNarrow && (
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						Tip: Project configs are useful for team settings. Global configs
						work across all projects.
					</Text>
				</Box>
			)}
		</Box>
	);
}
