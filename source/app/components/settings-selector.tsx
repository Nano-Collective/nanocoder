import {Box, Text, useInput} from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import SelectInput from 'ink-select-input';
import {useMemo, useState} from 'react';
import type {TitleShape} from '@/components/ui/styled-title';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {
	getNanocoderShape,
	getNotificationsPreference,
	getPasteThreshold,
	updateNanocoderShape,
	updateNotificationsPreference,
	updatePasteThreshold,
} from '@/config/preferences';
import {themes} from '@/config/themes';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {useTitleShape} from '@/hooks/useTitleShape';
import type {NotificationsConfig} from '@/types/config';
import type {NanocoderShape, ThemePreset} from '@/types/ui';
import {setNotificationsConfig} from '@/utils/notifications';
import {DEFAULT_SINGLE_LINE_PASTE_THRESHOLD} from '@/utils/paste-utils';

type SettingsStep =
	| 'main'
	| 'theme'
	| 'title-shape'
	| 'nanocoder-shape'
	| 'paste-threshold'
	| 'notifications'
	| 'done';

interface SettingsSelectorProps {
	onCancel: () => void;
}

interface MainMenuItem {
	label: string;
	value: SettingsStep;
	description: string;
}

// Main settings menu
function SettingsMainMenu({
	onSelect,
	onCancel,
}: {
	onSelect: (step: SettingsStep) => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const items: MainMenuItem[] = [
		{
			label: 'Theme',
			value: 'theme',
			description: 'Change color scheme',
		},
		{
			label: 'Title Shape',
			value: 'title-shape',
			description: 'Customize box title styles',
		},
		{
			label: 'Nanocoder Shape',
			value: 'nanocoder-shape',
			description: 'Change welcome banner font',
		},
		{
			label: 'Paste Threshold',
			value: 'paste-threshold',
			description: 'Set single-line paste character limit',
		},
		{
			label: 'Notifications',
			value: 'notifications',
			description: 'Desktop notification preferences',
		},
		{
			label: 'Done',
			value: 'done',
			description: 'Exit settings',
		},
	];

	useInput((_input, key) => {
		if (key.escape) {
			onCancel();
		}
	});

	// Narrow terminal: simplified layout (matches Status component pattern)
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
					Settings
				</Text>
				<Text color={colors.text}> </Text>
				<SelectInput
					items={items.map(item => ({
						label: item.label,
						value: item.value,
					}))}
					onSelect={item => {
						if (item.value === 'done') {
							onCancel();
						} else {
							onSelect(item.value as SettingsStep);
						}
					}}
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
			title="Settings"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={1}
			paddingY={1}
			flexDirection="column"
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>Select a setting to configure:</Text>
			</Box>
			<SelectInput
				items={items.map(item => ({
					label: `${item.label} - ${item.description}`,
					value: item.value,
				}))}
				onSelect={item => {
					if (item.value === 'done') {
						onCancel();
					} else {
						onSelect(item.value as SettingsStep);
					}
				}}
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
				<Text color={colors.secondary}>Enter to select, Esc to exit</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// Theme settings panel
function SettingsThemePanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const {colors, currentTheme, setCurrentTheme} = useTheme();
	const [originalTheme] = useState(currentTheme);

	useInput((_, key) => {
		if (key.escape) {
			setCurrentTheme(originalTheme);
			onCancel();
		}
		if (key.shift && key.tab) {
			setCurrentTheme(originalTheme);
			onBack();
		}
	});

	const themeOptions = Object.values(themes).map(theme => ({
		label: isNarrow
			? theme.displayName + (theme.name === originalTheme ? ' *' : '')
			: theme.displayName +
				' [' +
				theme.themeType.charAt(0).toUpperCase() +
				theme.themeType.slice(1) +
				']' +
				(theme.name === originalTheme ? ' (current)' : ''),
		value: theme.name as ThemePreset,
	}));

	const initialIndex = useMemo(() => {
		const index = themeOptions.findIndex(
			option => option.value === originalTheme,
		);
		return index >= 0 ? index : 0;
	}, [originalTheme, themeOptions]);

	const handleSelect = (item: {label: string; value: ThemePreset}) => {
		setCurrentTheme(item.value);
		onBack();
	};

	const handleHighlight = (item: {label: string; value: ThemePreset}) => {
		setCurrentTheme(item.value);
	};

	// Narrow terminal: simplified layout
	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title="Themes"
				width="100%"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<SelectInput
					items={themeOptions}
					initialIndex={initialIndex}
					onSelect={handleSelect}
					onHighlight={handleHighlight}
				/>
				<Box marginBottom={1}></Box>
				<Text color={colors.secondary}>Enter/Shift+Tab/Esc</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Choose your theme"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Enter to apply, Shift+Tab to go back, Esc to exit
				</Text>
			</Box>

			<SelectInput
				items={themeOptions}
				initialIndex={initialIndex}
				onSelect={handleSelect}
				onHighlight={handleHighlight}
			/>
		</TitledBoxWithPreferences>
	);
}

// Title Shape settings panel
function SettingsTitleShapePanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const {colors} = useTheme();
	const {currentTitleShape, setCurrentTitleShape} = useTitleShape();
	const [originalShape] = useState<TitleShape>(currentTitleShape);

	useInput((_, key) => {
		if (key.escape) {
			setCurrentTitleShape(originalShape);
			onCancel();
		}
		if (key.shift && key.tab) {
			setCurrentTitleShape(originalShape);
			onBack();
		}
	});

	const shapeOptions: {label: string; value: TitleShape}[] = isNarrow
		? [
				{label: 'Pill', value: 'pill'},
				{label: 'Rounded', value: 'rounded'},
				{label: 'Square', value: 'square'},
				{label: 'Double', value: 'double'},
				{label: 'Arrow Left', value: 'arrow-left'},
				{label: 'Arrow Right', value: 'arrow-right'},
				{label: 'Arrow Double', value: 'arrow-double'},
				{label: 'Angled Box', value: 'angled-box'},
				{label: 'PL Angled', value: 'powerline-angled'},
				{label: 'PL Angled Thin', value: 'powerline-angled-thin'},
				{label: 'PL Block', value: 'powerline-block'},
				{label: 'PL Block Alt', value: 'powerline-block-alt'},
				{label: 'PL Curved', value: 'powerline-curved'},
				{label: 'PL Curved Thin', value: 'powerline-curved-thin'},
				{label: 'PL Flame', value: 'powerline-flame'},
				{label: 'PL Flame Thin', value: 'powerline-flame-thin'},
				{label: 'PL Graph', value: 'powerline-graph'},
				{label: 'PL Ribbon', value: 'powerline-ribbon'},
				{label: 'PL Segment', value: 'powerline-segment'},
				{label: 'PL Segment Thin', value: 'powerline-segment-thin'},
			]
		: [
				{label: 'Pill :- Demo Title', value: 'pill'},
				{label: 'Rounded :- ╭ Demo Title ╮', value: 'rounded'},
				{label: 'Square :- ┌ Demo Title ┐', value: 'square'},
				{label: 'Double :- ╔ Demo Title ╗', value: 'double'},
				{label: 'Arrow Left :- ← Demo Title →', value: 'arrow-left'},
				{label: 'Arrow Right :- → Demo Title ←', value: 'arrow-right'},
				{label: 'Arrow Double :- « Demo Title »', value: 'arrow-double'},
				{label: 'Angled Box :- ╱ Demo Title ╲', value: 'angled-box'},
				{
					label: 'Powerline Angled (Nerd Fonts)',
					value: 'powerline-angled',
				},
				{
					label: 'Powerline Angled Thin (Nerd Fonts)',
					value: 'powerline-angled-thin',
				},
				{
					label: 'Powerline Block (Nerd Fonts)',
					value: 'powerline-block',
				},
				{
					label: 'Powerline Block Alt (Nerd Fonts)',
					value: 'powerline-block-alt',
				},
				{
					label: 'Powerline Curved (Nerd Fonts)',
					value: 'powerline-curved',
				},
				{
					label: 'Powerline Curved Thin (Nerd Fonts)',
					value: 'powerline-curved-thin',
				},
				{
					label: 'Powerline Flame (Nerd Fonts)',
					value: 'powerline-flame',
				},
				{
					label: 'Powerline Flame Thin (Nerd Fonts)',
					value: 'powerline-flame-thin',
				},
				{
					label: 'Powerline Graph (Nerd Fonts)',
					value: 'powerline-graph',
				},
				{
					label: 'Powerline Ribbon (Nerd Fonts)',
					value: 'powerline-ribbon',
				},
				{
					label: 'Powerline Segment (Nerd Fonts)',
					value: 'powerline-segment',
				},
				{
					label: 'Powerline Segment Thin (Nerd Fonts)',
					value: 'powerline-segment-thin',
				},
			];

	const initialIndex = useMemo(() => {
		const index = shapeOptions.findIndex(
			option => option.value === originalShape,
		);
		return index >= 0 ? index : 0;
	}, [originalShape, shapeOptions]);

	const handleSelect = (item: {label: string; value: TitleShape}) => {
		setCurrentTitleShape(item.value);
		onBack();
	};

	const handleHighlight = (item: {label: string; value: TitleShape}) => {
		setCurrentTitleShape(item.value);
	};

	// Narrow terminal: use TitledBoxWithPreferences to preview shape changes
	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title="Title Shapes"
				width="100%"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<SelectInput
					items={shapeOptions}
					initialIndex={initialIndex}
					onSelect={handleSelect}
					onHighlight={handleHighlight}
				/>
				<Box marginBottom={1}></Box>
				<Text color={colors.secondary}>Enter/Shift+Tab/Esc</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Choose your title shape"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Enter to apply, Shift+Tab to go back, Esc to exit
				</Text>
			</Box>

			<SelectInput
				items={shapeOptions}
				initialIndex={initialIndex}
				onSelect={handleSelect}
				onHighlight={handleHighlight}
			/>
		</TitledBoxWithPreferences>
	);
}

// Nanocoder Shape settings panel
function SettingsNanocoderShapePanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const {colors} = useTheme();

	const savedShape = getNanocoderShape();
	const initialShape: NanocoderShape = savedShape ?? 'tiny';
	const [originalShape] = useState<NanocoderShape>(initialShape);
	const [previewShape, setPreviewShape] =
		useState<NanocoderShape>(initialShape);

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	const shapeOptions: {label: string; value: NanocoderShape}[] = useMemo(
		() => [
			{label: 'Tiny (default)', value: 'tiny'},
			{label: 'Block', value: 'block'},
			{label: 'Simple', value: 'simple'},
			{label: 'Simple Block', value: 'simpleBlock'},
			{label: 'Slick', value: 'slick'},
			{label: 'Grid', value: 'grid'},
			{label: 'Pallet', value: 'pallet'},
			{label: 'Shade', value: 'shade'},
			{label: '3D', value: '3d'},
			{label: 'Simple 3D', value: 'simple3d'},
			{label: 'Chrome', value: 'chrome'},
			{label: 'Huge', value: 'huge'},
		],
		[],
	);

	const initialIndex = useMemo(() => {
		const index = shapeOptions.findIndex(
			option => option.value === originalShape,
		);
		return index >= 0 ? index : 0;
	}, [originalShape, shapeOptions]);

	const handleSelect = (item: {label: string; value: NanocoderShape}) => {
		updateNanocoderShape(item.value);
		onBack();
	};

	const handleHighlight = (item: {label: string; value: NanocoderShape}) => {
		setPreviewShape(item.value);
	};

	const displayText = isNarrow ? 'NC' : 'Nanocoder';

	// Narrow terminal: simplified layout with BigText outside box
	if (isNarrow) {
		return (
			<>
				<Gradient colors={[colors.primary, colors.tool]}>
					<BigText text={displayText} font={previewShape} />
				</Gradient>
				<TitledBoxWithPreferences
					title="Nanocoder Shape"
					width="100%"
					borderColor={colors.primary}
					paddingX={2}
					paddingY={1}
					flexDirection="column"
					marginBottom={1}
				>
					<SelectInput
						items={shapeOptions}
						initialIndex={initialIndex}
						onSelect={handleSelect}
						onHighlight={handleHighlight}
					/>
					<Box marginBottom={1}></Box>
					<Text color={colors.secondary}>Enter/Shift+Tab/Esc</Text>
				</TitledBoxWithPreferences>
			</>
		);
	}

	return (
		<>
			<Box marginBottom={1}>
				<Gradient colors={[colors.primary, colors.tool]}>
					<BigText text={displayText} font={previewShape} />
				</Gradient>
			</Box>

			<TitledBoxWithPreferences
				title="Choose your branding style"
				width={boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<Box marginBottom={1}>
					<Text color={colors.secondary}>
						Enter to apply, Shift+Tab to go back, Esc to exit
					</Text>
				</Box>

				<SelectInput
					items={shapeOptions}
					initialIndex={initialIndex}
					onSelect={handleSelect}
					onHighlight={handleHighlight}
				/>
			</TitledBoxWithPreferences>
		</>
	);
}

// Paste Threshold settings panel
function SettingsPasteThresholdPanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const {colors} = useTheme();

	const currentThreshold =
		getPasteThreshold() ?? DEFAULT_SINGLE_LINE_PASTE_THRESHOLD;

	const thresholdOptions = useMemo(
		() => [
			{label: '200', value: 200},
			{label: '400', value: 400},
			{label: '600', value: 600},
			{label: `800 (default)`, value: 800},
			{label: '1000', value: 1000},
			{label: '1500', value: 1500},
			{label: '2000', value: 2000},
			{label: '5000', value: 5000},
		],
		[],
	);

	const initialIndex = useMemo(() => {
		const index = thresholdOptions.findIndex(
			option => option.value === currentThreshold,
		);
		return index >= 0 ? index : 3; // default to 800
	}, [currentThreshold, thresholdOptions]);

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	const handleSelect = (item: {label: string; value: number}) => {
		updatePasteThreshold(item.value);
		onBack();
	};

	const title = isNarrow
		? 'Paste Threshold'
		: 'Set paste threshold (characters)';

	return (
		<TitledBoxWithPreferences
			title={title}
			width={isNarrow ? '100%' : boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{!isNarrow && (
				<Box marginBottom={1}>
					<Text color={colors.secondary}>
						Single-line pastes above this limit become placeholders. Current:{' '}
						{currentThreshold} chars
					</Text>
				</Box>
			)}
			{isNarrow && (
				<Text color={colors.secondary}>Current: {currentThreshold}</Text>
			)}
			<SelectInput
				items={thresholdOptions.map(opt => ({
					label:
						opt.value === currentThreshold
							? isNarrow
								? `${opt.label} *`
								: `${opt.label} (current)`
							: opt.label,
					value: opt.value,
				}))}
				initialIndex={initialIndex}
				onSelect={handleSelect}
			/>
			<Box marginTop={isNarrow ? 0 : 1}>
				<Text color={colors.secondary}>
					{isNarrow
						? 'Enter/Shift+Tab/Esc'
						: 'Enter to apply, Shift+Tab to go back, Esc to exit'}
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// Notifications settings panel
function SettingsNotificationsPanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const {colors} = useTheme();

	const saved = getNotificationsPreference();
	const [config, setConfig] = useState<NotificationsConfig>(
		saved ?? {
			enabled: false,
			sound: false,
			events: {
				toolConfirmation: true,
				questionPrompt: true,
				generationComplete: true,
			},
		},
	);

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	type ToggleKey =
		| 'enabled'
		| 'sound'
		| 'toolConfirmation'
		| 'questionPrompt'
		| 'generationComplete';

	const items: {label: string; value: ToggleKey}[] = useMemo(() => {
		const isOn = (val: boolean | undefined) => (val ? 'ON' : 'OFF');
		return [
			{
				label: `Notifications: ${isOn(config.enabled)}`,
				value: 'enabled' as ToggleKey,
			},
			{
				label: `  Sound: ${isOn(config.sound)}`,
				value: 'sound' as ToggleKey,
			},
			{
				label: `  Tool Confirmation: ${isOn(config.events?.toolConfirmation)}`,
				value: 'toolConfirmation' as ToggleKey,
			},
			{
				label: `  Question Prompt: ${isOn(config.events?.questionPrompt)}`,
				value: 'questionPrompt' as ToggleKey,
			},
			{
				label: `  Generation Complete: ${isOn(config.events?.generationComplete)}`,
				value: 'generationComplete' as ToggleKey,
			},
		];
	}, [config]);

	const handleSelect = (item: {label: string; value: ToggleKey}) => {
		const next = {...config};
		if (item.value === 'enabled') {
			next.enabled = !next.enabled;
		} else if (item.value === 'sound') {
			next.sound = !next.sound;
		} else {
			next.events = {...next.events, [item.value]: !next.events?.[item.value]};
		}
		setConfig(next);
		updateNotificationsPreference(next);
		setNotificationsConfig(next);
	};

	const title = isNarrow ? 'Notifications' : 'Desktop Notifications';

	return (
		<TitledBoxWithPreferences
			title={title}
			width={isNarrow ? '100%' : boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{!isNarrow && (
				<Box marginBottom={1}>
					<Text color={colors.secondary}>
						Toggle settings with Enter. Shift+Tab to go back, Esc to exit
					</Text>
				</Box>
			)}
			<SelectInput
				items={items}
				onSelect={handleSelect}
				indicatorComponent={({isSelected}) => (
					<Text color={isSelected ? colors.primary : colors.text}>
						{isSelected ? '> ' : '  '}
					</Text>
				)}
				itemComponent={({isSelected, label}) => (
					<Text color={isSelected ? colors.primary : colors.text}>{label}</Text>
				)}
			/>
			{isNarrow && (
				<Box marginTop={0}>
					<Text color={colors.secondary}>Enter/Shift+Tab/Esc</Text>
				</Box>
			)}
		</TitledBoxWithPreferences>
	);
}

// Main settings selector with step navigation
export function SettingsSelector({onCancel}: SettingsSelectorProps) {
	const [step, setStep] = useState<SettingsStep>('main');

	switch (step) {
		case 'main':
			return <SettingsMainMenu onSelect={setStep} onCancel={onCancel} />;
		case 'theme':
			return (
				<SettingsThemePanel
					onBack={() => setStep('main')}
					onCancel={onCancel}
				/>
			);
		case 'title-shape':
			return (
				<SettingsTitleShapePanel
					onBack={() => setStep('main')}
					onCancel={onCancel}
				/>
			);
		case 'nanocoder-shape':
			return (
				<SettingsNanocoderShapePanel
					onBack={() => setStep('main')}
					onCancel={onCancel}
				/>
			);
		case 'paste-threshold':
			return (
				<SettingsPasteThresholdPanel
					onBack={() => setStep('main')}
					onCancel={onCancel}
				/>
			);
		case 'notifications':
			return (
				<SettingsNotificationsPanel
					onBack={() => setStep('main')}
					onCancel={onCancel}
				/>
			);
	}
}
