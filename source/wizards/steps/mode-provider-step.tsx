import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useState} from 'react';
import {VALID_MODES} from '@/app/types';
import TextInput from '@/components/text-input';
import {getColors} from '@/config/index';
import type {ModeProviderConfig, ProviderConfig} from '../../types/config';
import type {DevelopmentMode} from '../../types/core';

interface ModeProviderStepProps {
	providers: ProviderConfig[];
	existingModeProviders?: Partial<Record<DevelopmentMode, ModeProviderConfig>>;
	onComplete: (
		modeProviders: Partial<Record<DevelopmentMode, ModeProviderConfig>>,
	) => void;
	onBack: () => void;
}

type Mode =
	| 'select-mode'
	| 'select-provider'
	| 'select-model'
	| 'enter-temperature';
type SelectModeValue = DevelopmentMode | 'done' | 'clear';
type SelectProviderValue = string | 'clear';

export function ModeProviderStep({
	providers,
	existingModeProviders = {},
	onComplete,
	onBack,
}: ModeProviderStepProps) {
	const colors = getColors();

	const [modeProviders, setModeProviders] = useState<
		Partial<Record<DevelopmentMode, ModeProviderConfig>>
	>(existingModeProviders);
	const [mode, setMode] = useState<Mode>('select-mode');

	const [selectedDevMode, setSelectedDevMode] =
		useState<DevelopmentMode | null>(null);
	const [selectedProvider, setSelectedProvider] =
		useState<ProviderConfig | null>(null);
	const [selectedModel, setSelectedModel] = useState<string | null>(null);
	const [temperatureStr, setTemperatureStr] = useState<string>('');

	useInput((input, key) => {
		if (key.escape || (input === 'b' && key.ctrl)) {
			if (mode === 'select-mode') {
				onBack();
			} else if (mode === 'select-provider') {
				setMode('select-mode');
			} else if (mode === 'select-model') {
				setMode('select-provider');
			} else if (mode === 'enter-temperature') {
				setMode('select-model');
			}
		}
	});

	if (providers.length === 0) {
		return (
			<Box flexDirection="column" gap={1}>
				<Text color={colors.warning}>No providers configured yet.</Text>
				<Text>
					Please configure at least one provider before setting up mode-specific
					providers.
				</Text>
				<SelectInput
					items={[{label: 'Go back', value: 'back'}]}
					onSelect={() => onBack()}
				/>
			</Box>
		);
	}

	if (mode === 'select-mode') {
		const items = (VALID_MODES as readonly string[]).map(m => {
			const config = modeProviders[m as DevelopmentMode];
			const label = config
				? `${m} (Current: ${config.provider} - ${config.model})`
				: `${m} (Unconfigured)`;
			return {label, value: m as SelectModeValue};
		});

		return (
			<Box flexDirection="column" gap={1}>
				<Text color={colors.primary}>Configure Mode-Specific Providers</Text>
				<Text>Select a mode to configure (Esc to go back):</Text>
				<SelectInput<SelectModeValue>
					items={[
						...items,
						{label: 'Clear All Mode Providers', value: 'clear'},
						{label: 'Done', value: 'done'},
					]}
					onSelect={item => {
						if (item.value === 'done') {
							onComplete(modeProviders);
						} else if (item.value === 'clear') {
							setModeProviders({});
						} else {
							setSelectedDevMode(item.value as DevelopmentMode);
							setMode('select-provider');
						}
					}}
				/>
			</Box>
		);
	}

	if (mode === 'select-provider') {
		const items = providers.map(p => ({
			label: p.name,
			value: p.name as SelectProviderValue,
		}));

		return (
			<Box flexDirection="column" gap={1}>
				<Text color={colors.primary}>
					Select Provider for {selectedDevMode}
				</Text>
				<Text color={colors.secondary}>(Esc to go back)</Text>
				<SelectInput<SelectProviderValue>
					items={[...items, {label: 'Clear mode override', value: 'clear'}]}
					onSelect={item => {
						if (item.value === 'clear') {
							setModeProviders(prev => {
								const next = {...prev};
								delete next[selectedDevMode!];
								return next;
							});
							setMode('select-mode');
						} else {
							const provider = providers.find(p => p.name === item.value);
							if (provider) {
								setSelectedProvider(provider);
								if (provider.models.length > 0) {
									setMode('select-model');
								} else {
									setSelectedModel('default');
									setTemperatureStr(
										modeProviders[selectedDevMode!]?.temperature?.toString() ||
											'',
									);
									setMode('enter-temperature');
								}
							}
						}
					}}
				/>
			</Box>
		);
	}

	if (mode === 'select-model') {
		const items = selectedProvider!.models.map(m => ({
			label: m,
			value: m,
		}));

		return (
			<Box flexDirection="column" gap={1}>
				<Text color={colors.primary}>
					Select Model for {selectedDevMode} ({selectedProvider!.name})
				</Text>
				<Text color={colors.secondary}>(Esc to go back)</Text>
				<SelectInput
					items={items}
					onSelect={item => {
						setSelectedModel(item.value);
						setTemperatureStr(
							modeProviders[selectedDevMode!]?.temperature?.toString() || '',
						);
						setMode('enter-temperature');
					}}
				/>
			</Box>
		);
	}

	if (mode === 'enter-temperature') {
		return (
			<Box flexDirection="column" gap={1}>
				<Text color={colors.primary}>
					Temperature for {selectedDevMode} (optional, 0.0 to 2.0)
				</Text>
				<Box borderStyle="round" borderColor={colors.secondary}>
					<TextInput
						value={temperatureStr}
						onChange={setTemperatureStr}
						onSubmit={() => {
							const temp = temperatureStr?.trim()
								? parseFloat(temperatureStr)
								: undefined;
							setModeProviders(prev => ({
								...prev,
								[selectedDevMode!]: {
									provider: selectedProvider!.name,
									model: selectedModel!,
									...(temp !== undefined && !isNaN(temp)
										? {temperature: temp}
										: {}),
								},
							}));
							setMode('select-mode');
						}}
					/>
				</Box>
				<Text color={colors.secondary}>
					Press Enter to save, or Esc to go back
				</Text>
			</Box>
		);
	}

	return null;
}
