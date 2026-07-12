import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useState} from 'react';
import {VALID_MODES} from '@/app/types';
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

type Mode = 'select-mode' | 'select-provider' | 'select-model';
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

	useInput((input, key) => {
		if (key.escape || (input === 'b' && key.ctrl)) {
			if (mode === 'select-mode') {
				onBack();
			} else if (mode === 'select-provider') {
				setMode('select-mode');
			} else if (mode === 'select-model') {
				setMode('select-provider');
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
									// Provider allows any model - use 'default' as placeholder
									setModeProviders(prev => ({
										...prev,
										[selectedDevMode!]: {
											provider: provider.name,
											model: 'default',
										},
									}));
									setMode('select-mode');
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
						setModeProviders(prev => ({
							...prev,
							[selectedDevMode!]: {
								provider: selectedProvider!.name,
								model: item.value,
							},
						}));
						setMode('select-mode');
					}}
				/>
			</Box>
		);
	}

	return null;
}
