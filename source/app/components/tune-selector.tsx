import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useMemo, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {
	TOOL_PROFILE_DESCRIPTIONS,
	TOOL_PROFILE_TOOLTIPS,
} from '@/tools/tool-profiles';
import type {ModelParameters, ToolProfile, TuneConfig} from '@/types/config';
import {TUNE_DEFAULTS} from '@/types/config';

type Step = 'main' | 'toolProfile' | 'parameters' | 'preset';

const AVAILABLE_PROFILES: ToolProfile[] = ['full', 'minimal'];

interface TuneSelectorProps {
	currentConfig: TuneConfig;
	onSelect: (config: TuneConfig) => void;
	onCancel: () => void;
}

type MainAction =
	| 'toggle'
	| 'preset'
	| 'toolProfile'
	| 'aggressiveCompact'
	| 'disableNativeTools'
	| 'parameters'
	| 'apply';

// Preset definitions — static configs that populate the tune form
interface TunePreset {
	name: string;
	description: string;
	config: TuneConfig;
}

const TUNE_PRESETS: TunePreset[] = [
	{
		name: 'Default',
		description: 'Reset all settings to defaults',
		config: {...TUNE_DEFAULTS},
	},
	{
		name: 'Small Model',
		description:
			'Optimised for 1B-8B models — minimal tools, slim prompt, single-tool, aggressive compact',
		config: {
			enabled: true,
			toolProfile: 'minimal',
			aggressiveCompact: true,
			modelParameters: {temperature: 0.7},
		},
	},
];

// Main model mode menu
function TuneMainMenu({
	config,
	onAction,
	onCancel,
}: {
	config: TuneConfig;
	onAction: (action: MainAction) => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const items = useMemo(() => {
		const list: {label: string; value: MainAction}[] = [
			{
				label: config.enabled ? 'Tune - Enabled' : 'Tune - Disabled',
				value: 'toggle',
			},
			{
				label: 'Load Preset',
				value: 'preset',
			},
		];

		if (config.enabled) {
			list.push(
				{
					label: `Tool Profile - ${config.toolProfile}`,
					value: 'toolProfile',
				},
				{
					label: `Aggressive Compact - ${config.aggressiveCompact ? 'ON' : 'OFF'}`,
					value: 'aggressiveCompact',
				},
				{
					label: `Native Tool Calling - ${config.disableNativeTools ? 'OFF (XML fallback)' : 'ON'}`,
					value: 'disableNativeTools',
				},
				{
					label: `Model Parameters - ${config.modelParameters ? 'configured' : 'defaults'}`,
					value: 'parameters',
				},
			);
		}

		list.push({label: 'Apply & Close', value: 'apply'});

		return list;
	}, [config]);

	useInput((_input, key) => {
		if (key.escape) {
			onCancel();
		}
	});

	// Narrow terminal: simplified layout
	if (isNarrow) {
		return (
			<Box
				flexDirection="column"
				marginBottom={1}
				borderStyle="round"
				borderColor={colors.primary}
				paddingY={1}
				paddingX={2}
				width="100%"
			>
				<Text color={colors.primary} bold>
					Tune
				</Text>
				<Text color={colors.text}> </Text>
				<SelectInput
					items={items}
					onSelect={item => onAction(item.value)}
					indicatorComponent={({isSelected}) => (
						<Text color={isSelected ? colors.primary : colors.text}>
							{isSelected ? '> ' : '  '}
						</Text>
					)}
					itemComponent={({isSelected, label}) => (
						<Text color={isSelected ? colors.primary : colors.text}>
							{label}
						</Text>
					)}
				/>
				<Box marginBottom={1}></Box>
				<Text color={colors.secondary}>Enter/Esc</Text>
			</Box>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Tune"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Configure runtime behavior for different model capabilities:
				</Text>
			</Box>
			<SelectInput
				items={items}
				onSelect={item => onAction(item.value)}
				indicatorComponent={({isSelected}) => (
					<Text color={isSelected ? colors.primary : colors.text}>
						{isSelected ? '> ' : '  '}
					</Text>
				)}
				itemComponent={({isSelected, label}) => (
					<Text color={isSelected ? colors.primary : colors.text}>{label}</Text>
				)}
			/>
			<Box marginTop={1}>
				<Text color={colors.secondary}>Enter to select, Esc to cancel</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// Tool profile sub-panel
function ToolProfilePanel({
	currentProfile,
	onSelect,
	onBack,
	onCancel,
}: {
	currentProfile: ToolProfile;
	onSelect: (profile: ToolProfile) => void;
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const [highlighted, setHighlighted] = useState<ToolProfile>(currentProfile);

	const items = useMemo(
		() =>
			AVAILABLE_PROFILES.map(p => ({
				label: isNarrow
					? p + (p === currentProfile ? ' *' : '')
					: `${p} - ${TOOL_PROFILE_DESCRIPTIONS[p]}${p === currentProfile ? ' (current)' : ''}`,
				value: p,
			})),
		[currentProfile, isNarrow],
	);

	const initialIndex = useMemo(() => {
		const index = AVAILABLE_PROFILES.indexOf(currentProfile);
		return index >= 0 ? index : 0;
	}, [currentProfile]);

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	// Narrow terminal: simplified layout
	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title="Tool Profile"
				width="100%"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<SelectInput
					items={items}
					initialIndex={initialIndex}
					onSelect={item => onSelect(item.value as ToolProfile)}
					onHighlight={item => setHighlighted(item.value as ToolProfile)}
				/>
				<Box marginTop={1} flexDirection="column">
					<Text color={colors.secondary}>
						{TOOL_PROFILE_TOOLTIPS[highlighted]}
					</Text>
				</Box>
				<Box marginBottom={1}></Box>
				<Text color={colors.secondary}>Enter/Shift+Tab/Esc</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Choose a tool profile"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Enter to apply, Shift+Tab to go back, Esc to cancel
				</Text>
			</Box>
			<SelectInput
				items={items}
				initialIndex={initialIndex}
				onSelect={item => onSelect(item.value as ToolProfile)}
				onHighlight={item => setHighlighted(item.value as ToolProfile)}
				indicatorComponent={({isSelected}) => (
					<Text color={isSelected ? colors.primary : colors.text}>
						{isSelected ? '> ' : '  '}
					</Text>
				)}
				itemComponent={({isSelected, label}) => (
					<Text color={isSelected ? colors.primary : colors.text}>{label}</Text>
				)}
			/>
			<Box marginTop={1} flexDirection="column">
				<Text color={colors.secondary}>
					{TOOL_PROFILE_TOOLTIPS[highlighted]}
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// Preset sub-panel
function PresetPanel({
	onSelect,
	onBack,
	onCancel,
}: {
	onSelect: (config: TuneConfig) => void;
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const [highlighted, setHighlighted] = useState(0);

	const items = useMemo(
		() =>
			TUNE_PRESETS.map((preset, i) => ({
				label: isNarrow
					? preset.name
					: `${preset.name} - ${preset.description}`,
				value: String(i),
			})),
		[isNarrow],
	);

	useInput((_input, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	const highlightedPreset = TUNE_PRESETS[highlighted];

	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title="Presets"
				width="100%"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<SelectInput
					items={items}
					onSelect={item => onSelect(TUNE_PRESETS[Number(item.value)]?.config)}
					onHighlight={item => setHighlighted(Number(item.value))}
				/>
				{highlightedPreset && (
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							{highlightedPreset.description}
						</Text>
					</Box>
				)}
				<Box marginBottom={1}></Box>
				<Text color={colors.secondary}>Enter/Shift+Tab/Esc</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Load a preset"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Enter to load preset, Shift+Tab to go back, Esc to cancel
				</Text>
			</Box>
			<SelectInput
				items={items}
				onSelect={item => onSelect(TUNE_PRESETS[Number(item.value)]?.config)}
				onHighlight={item => setHighlighted(Number(item.value))}
				indicatorComponent={({isSelected}) => (
					<Text color={isSelected ? colors.primary : colors.text}>
						{isSelected ? '> ' : '  '}
					</Text>
				)}
				itemComponent={({isSelected, label}) => (
					<Text color={isSelected ? colors.primary : colors.text}>{label}</Text>
				)}
			/>
			{highlightedPreset && (
				<Box marginTop={1}>
					<Text color={colors.secondary}>{highlightedPreset.description}</Text>
				</Box>
			)}
		</TitledBoxWithPreferences>
	);
}

// Parameter definitions with validation
const PARAM_DEFS: {
	key: keyof ModelParameters;
	label: string;
	tooltip: string;
	min: number;
	max: number;
	step: number;
}[] = [
	{
		key: 'temperature',
		label: 'Temperature',
		tooltip:
			'Controls randomness. Lower = more focused, higher = more creative.',
		min: 0.1,
		max: 2,
		step: 0.1,
	},
	{
		key: 'topP',
		label: 'Top P',
		tooltip: 'Nucleus sampling. Lower = fewer token choices considered.',
		min: 0,
		max: 1,
		step: 0.05,
	},
	{
		key: 'topK',
		label: 'Top K',
		tooltip:
			'Limits token choices to top K candidates. Lower = more deterministic.',
		min: 1,
		max: 200,
		step: 1,
	},
	{
		key: 'maxTokens',
		label: 'Max Tokens',
		tooltip:
			'Maximum response length. Useful for limiting verbose models or reducing costs.',
		min: 64,
		max: 32768,
		step: 256,
	},
	{
		key: 'frequencyPenalty',
		label: 'Frequency Penalty',
		tooltip: 'Penalises repeated tokens. Higher = less repetition.',
		min: -2,
		max: 2,
		step: 0.1,
	},
	{
		key: 'presencePenalty',
		label: 'Presence Penalty',
		tooltip: 'Penalises tokens already used. Higher = more topic diversity.',
		min: -2,
		max: 2,
		step: 0.1,
	},
];

// Model parameters sub-panel
function ParametersPanel({
	currentParams,
	onApply,
	onBack,
	onCancel,
}: {
	currentParams?: ModelParameters;
	onApply: (params: ModelParameters | undefined) => void;
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	// Local state so changes don't close the panel
	const [params, setParams] = useState<ModelParameters | undefined>(
		currentParams ? {...currentParams} : undefined,
	);

	const items = useMemo(() => {
		const fmtValue = (value: number | string[] | undefined) => {
			if (value === undefined) return 'default';
			if (Array.isArray(value)) return value.join(', ');
			return String(value);
		};
		const list: {label: string; value: string}[] = PARAM_DEFS.map(def => ({
			label: `${def.label} - ${fmtValue(params?.[def.key])}`,
			value: def.key,
		}));
		list.push(
			{label: 'Reset All to Defaults', value: 'reset'},
			{label: 'Done', value: 'done'},
		);
		return list;
	}, [params]);

	const [highlighted, setHighlighted] = useState<string>('temperature');
	const highlightedDef = PARAM_DEFS.find(d => d.key === highlighted);

	useInput((_input, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onApply(params);
			onBack();
		}
	});

	const handleSelect = (item: {value: string}) => {
		if (item.value === 'done') {
			onApply(params);
			onBack();
			return;
		}
		if (item.value === 'reset') {
			setParams(undefined);
			return;
		}

		// Cycle through values for the selected parameter
		const def = PARAM_DEFS.find(d => d.key === item.value);
		if (!def) return;

		const currentValue = params?.[def.key] as number | undefined;

		let nextValue: number | undefined;
		if (currentValue === undefined) {
			// Start from a sensible default
			nextValue =
				def.key === 'temperature'
					? 0.7
					: def.key === 'topP'
						? 0.9
						: def.key === 'topK'
							? 40
							: def.key === 'maxTokens'
								? 4096
								: 0;
		} else {
			// Increment, wrap to undefined (default) after max
			const stepped = Math.round((currentValue + def.step) * 100) / 100;
			nextValue = stepped > def.max ? undefined : stepped;
		}

		setParams(prev => ({
			...prev,
			[def.key]: nextValue,
		}));
	};

	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title="Parameters"
				width="100%"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<SelectInput
					items={items}
					onSelect={handleSelect}
					onHighlight={item => setHighlighted(item.value)}
				/>
				{highlightedDef && (
					<Box marginTop={1}>
						<Text color={colors.secondary}>{highlightedDef.tooltip}</Text>
					</Box>
				)}
				<Box marginBottom={1}></Box>
				<Text color={colors.secondary}>Enter to cycle/Shift+Tab/Esc</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Model Parameters"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Enter to cycle values, Shift+Tab to go back, Esc to cancel
				</Text>
			</Box>
			<SelectInput
				items={items}
				onSelect={handleSelect}
				onHighlight={item => setHighlighted(item.value)}
				indicatorComponent={({isSelected}) => (
					<Text color={isSelected ? colors.primary : colors.text}>
						{isSelected ? '> ' : '  '}
					</Text>
				)}
				itemComponent={({isSelected, label}) => (
					<Text color={isSelected ? colors.primary : colors.text}>{label}</Text>
				)}
			/>
			{highlightedDef && (
				<Box marginTop={1}>
					<Text color={colors.secondary}>{highlightedDef.tooltip}</Text>
				</Box>
			)}
		</TitledBoxWithPreferences>
	);
}

// Main tune selector with step navigation
export function TuneSelector({
	currentConfig,
	onSelect,
	onCancel,
}: TuneSelectorProps) {
	const [step, setStep] = useState<Step>('main');
	const [config, setConfig] = useState<TuneConfig>({...currentConfig});

	const handleMainAction = (action: MainAction) => {
		switch (action) {
			case 'toggle':
				setConfig(prev => ({
					...(prev.enabled ? TUNE_DEFAULTS : prev),
					enabled: !prev.enabled,
				}));
				break;
			case 'preset':
				setStep('preset');
				break;
			case 'toolProfile':
				setStep('toolProfile');
				break;
			case 'aggressiveCompact':
				setConfig(prev => ({
					...prev,
					aggressiveCompact: !prev.aggressiveCompact,
				}));
				break;
			case 'disableNativeTools':
				setConfig(prev => ({
					...prev,
					disableNativeTools: !prev.disableNativeTools,
				}));
				break;
			case 'parameters':
				setStep('parameters');
				break;
			case 'apply':
				onSelect(config);
				break;
		}
	};

	switch (step) {
		case 'main':
			return (
				<TuneMainMenu
					config={config}
					onAction={handleMainAction}
					onCancel={onCancel}
				/>
			);
		case 'toolProfile':
			return (
				<ToolProfilePanel
					currentProfile={config.toolProfile}
					onSelect={profile => {
						setConfig(prev => ({...prev, toolProfile: profile}));
						setStep('main');
					}}
					onBack={() => setStep('main')}
					onCancel={onCancel}
				/>
			);
		case 'parameters':
			return (
				<ParametersPanel
					currentParams={config.modelParameters}
					onApply={params => {
						setConfig(prev => ({...prev, modelParameters: params}));
						setStep('main');
					}}
					onBack={() => setStep('main')}
					onCancel={onCancel}
				/>
			);
		case 'preset':
			return (
				<PresetPanel
					onSelect={presetConfig => {
						setConfig({...presetConfig});
						setStep('main');
					}}
					onBack={() => setStep('main')}
					onCancel={onCancel}
				/>
			);
	}
}
