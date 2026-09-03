import {Box, Text, useInput} from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import {type ReactNode, useMemo, useState} from 'react';
import {StyledSelectInput} from '@/components/ui/styled-select-input';
import type {TitleShape} from '@/components/ui/styled-title';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {
	getCompactToolDisplay,
	getNanocoderShape,
	getNotificationsPreference,
	getPasteThreshold,
	getPrivacyPreference,
	getProjectContextPreferences,
	getReasoningExpanded,
	getShowUsageFooter,
	updateCompactToolDisplay,
	updateNanocoderShape,
	updateNotificationsPreference,
	updatePasteThreshold,
	updatePrivacyPreference,
	updateReasoningExpanded,
	updateSelectedTheme,
	updateSemanticMemoryEnabled,
	updateSemanticMemoryLimit,
	updateSemanticMemoryTokenBudget,
	updateShowUsageFooter,
} from '@/config/preferences';
import {getThemeColors, themes} from '@/config/themes';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {useTitleShape} from '@/hooks/useTitleShape';
import type {NotificationsConfig} from '@/types/config';
import type {NanocoderShape, ThemePreset} from '@/types/ui';
import {setNotificationsConfig} from '@/utils/notifications';
import {DEFAULT_SINGLE_LINE_PASTE_THRESHOLD} from '@/utils/paste-utils';
import type {SettingsTabId} from './settings-constants';

/**
 * The set of "managed" settings panels: preserved full-featured sub-UIs that
 * the tabbed Settings dialog (`settings-tabs.tsx`) opens in place of the old
 * top-level menu. `main`/`done` no longer exist as panel states — the tab
 * dialog's own list/header modes replace them.
 */
export type ManagedSettingsPanel =
	| 'theme'
	| 'title-shape'
	| 'nanocoder-shape'
	| 'paste-threshold'
	| 'notifications'
	| 'display-settings'
	| 'privacy'
	| 'semantic-memory'
	| 'json-config'
	| 'web-search'
	| 'providers-config'
	| 'mcp-config'
	| 'default-mode'
	| 'reasoning-traces'
	| 'auto-compact'
	| 'sessions'
	| 'tool-approval'
	| 'environment';

export interface SettingsSelectorProps {
	onCancel: () => void;
	/** Close settings and launch the tune wizard (app-level mode switch). */
	onLaunchTune?: () => void;
	/** Close settings and launch the IDE-connection wizard. */
	onLaunchIde?: () => void;
	/**
	 * Rebuild the live MCP connections after the MCP panel edits config. Without
	 * this, servers added here only take effect on the next launch.
	 */
	onMcpChanged?: () => void | Promise<void>;
	/**
	 * Rebuild the client for the current provider/model after the Providers panel
	 * edits config, without clearing messages or resetting to default provider.
	 */
	onProvidersChanged?: () => void | Promise<void>;
	/**
	 * The tab to open initially. Defaults to 'appearance' if not specified.
	 */
	initialTab?: SettingsTabId;
	/**
	 * Called when the active tab changes, so the parent can track it for
	 * returning after launching wizards.
	 */
	onTabChange?: (tab: SettingsTabId) => void;
}

function ThemePreviewMessage({
	accentColor,
	baseColor,
	children,
	compact = false,
}: {
	accentColor: string;
	baseColor: string;
	children: ReactNode;
	compact?: boolean;
}) {
	return (
		<Box
			flexDirection="column"
			backgroundColor={baseColor}
			paddingX={2}
			paddingY={compact ? 0 : 1}
			borderStyle="bold"
			borderLeft={true}
			borderRight={false}
			borderTop={false}
			borderBottom={false}
			borderLeftColor={accentColor}
		>
			{children}
		</Box>
	);
}

function ThemeMiniPreview({
	colors,
	compact = false,
}: {
	colors: ReturnType<typeof useTheme>['colors'];
	compact?: boolean;
}) {
	return (
		<Box flexDirection="column">
			<Box flexDirection="column" marginBottom={compact ? 0 : 1}>
				<Box marginBottom={1}>
					<Text color={colors.primary} bold>
						You:
					</Text>
				</Box>
				<ThemePreviewMessage
					accentColor={colors.primary}
					baseColor={colors.base}
					compact={compact}
				>
					<Text color={colors.text}>
						Refactor this function and show the diff.
					</Text>
				</ThemePreviewMessage>
			</Box>

			<Box flexDirection="column" marginBottom={compact ? 0 : 1}>
				<Box marginBottom={1}>
					<Text color={colors.info} bold>
						Nanocoder:
					</Text>
				</Box>

				<ThemePreviewMessage
					accentColor={colors.secondary}
					baseColor={colors.base}
					compact={compact}
				>
					<Text color={colors.text}>
						I'll inspect the file and make a safe change.
					</Text>
				</ThemePreviewMessage>
			</Box>

			<Box flexDirection="column" marginBottom={compact ? 0 : 1}>
				<Text color={colors.tool}>⚒ read_file source/app.tsx</Text>
				<Text color={colors.success}>⚒ Completed successfully</Text>
				{!compact && (
					<Text color={colors.warning}>
						⚠ Review generated changes before commit
					</Text>
				)}
			</Box>

			<Box flexDirection="column" marginTop={compact ? 0 : 1}>
				<Box>
					<Text color={colors.secondary}>1 </Text>
					<Text
						bold
						underline
						backgroundColor={colors.diffRemoved}
						color={colors.diffRemovedText}
					>
						- return theme;
					</Text>
				</Box>
				<Box>
					<Text color={colors.secondary}>2 </Text>
					<Text
						bold
						underline
						backgroundColor={colors.diffAdded}
						color={colors.diffAddedText}
					>
						+ return formatTheme(theme);
					</Text>
				</Box>
			</Box>
		</Box>
	);
}

// Theme settings panel
export function SettingsThemePanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const {currentTheme, setCurrentTheme} = useTheme();
	const [originalTheme] = useState(currentTheme);

	const themeList = Object.values(themes);
	const [currentIndex, setCurrentIndex] = useState(() => {
		const index = themeList.findIndex(theme => theme.name === currentTheme);
		return index >= 0 ? index : 0;
	});

	// Preview theme is the one being browsed (for UI only)
	const previewTheme = themeList[currentIndex];
	// Get the colors for the preview theme
	const previewColors = getThemeColors(previewTheme.name as ThemePreset);

	useInput((input, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
		if (key.upArrow) {
			setCurrentIndex(prev => (prev > 0 ? prev - 1 : themeList.length - 1));
		}
		if (key.downArrow) {
			setCurrentIndex(prev => (prev < themeList.length - 1 ? prev + 1 : 0));
		}
		if (key.return) {
			// Only save to preferences on Enter
			setCurrentTheme(previewTheme.name as ThemePreset);
			updateSelectedTheme(previewTheme.name as ThemePreset);
			onBack();
		}
	});

	const themeName = `${previewTheme.displayName} [${
		currentIndex + 1
	}/${themeList.length}]`;
	const isCurrentTheme = previewTheme.name === originalTheme;

	// Narrow terminal: simplified layout
	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title="Theme"
				width="100%"
				borderColor={previewColors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<Text color={previewColors.primary}>
					{isCurrentTheme ? '* ' : ''}
					{themeName}
				</Text>
				<ThemeMiniPreview colors={previewColors} compact />
				<Box marginBottom={1}></Box>
				<Text color={previewColors.secondary}>
					↑↓ navigate · Enter select · Esc back
				</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Theme"
			width={boxWidth}
			borderColor={previewColors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Text color={previewColors.primary} bold>
				{isCurrentTheme ? '* ' : ''}
				{themeName}
			</Text>
			<Box marginBottom={1}>
				<Text color={previewColors.secondary}>
					↑↓ navigate · Enter apply · Shift+Tab back · Esc back
				</Text>
			</Box>

			<ThemeMiniPreview colors={previewColors} />
		</TitledBoxWithPreferences>
	);
}

// Title Shape settings panel
export function SettingsTitleShapePanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const {colors} = useTheme();
	const {currentTitleShape, setCurrentTitleShape, commitTitleShape} =
		useTitleShape();
	const [originalShape] = useState<TitleShape>(currentTitleShape);

	useInput((_, key) => {
		if (key.escape) {
			// Esc/Shift+Tab = cancel. Navigation only previews via
			// setCurrentTitleShape (in-memory, never persisted), so revert the
			// in-memory preview back to the shape the panel was opened with
			// before navigating away. Nothing is written to disk on cancel.
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
		// Only commit (persist to disk) on an explicit Enter.
		commitTitleShape(item.value);
		onBack();
	};

	const handleHighlight = (item: {label: string; value: TitleShape}) => {
		// Preview only — updates the in-memory app title live but does NOT
		// persist. Canceling (Esc/Shift+Tab) reverts this with no disk write.
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
				<StyledSelectInput
					items={shapeOptions}
					initialIndex={initialIndex}
					onSelect={handleSelect}
					onHighlight={handleHighlight}
				/>
				<Box marginBottom={1}></Box>
				<Text color={colors.secondary}>
					Enter to apply · Shift+Tab back · Esc back
				</Text>
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
					Enter to apply · Shift+Tab back · Esc back
				</Text>
			</Box>

			<StyledSelectInput
				items={shapeOptions}
				initialIndex={initialIndex}
				onSelect={handleSelect}
				onHighlight={handleHighlight}
			/>
		</TitledBoxWithPreferences>
	);
}

// Nanocoder Shape settings panel
export function SettingsNanocoderShapePanel({
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
					<StyledSelectInput
						items={shapeOptions}
						initialIndex={initialIndex}
						onSelect={handleSelect}
						onHighlight={handleHighlight}
					/>
					<Box marginBottom={1}></Box>
					<Text color={colors.secondary}>
						Enter to apply · Shift+Tab back · Esc back
					</Text>
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
						Enter to apply · Shift+Tab back · Esc back
					</Text>
				</Box>

				<StyledSelectInput
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
export function SettingsPasteThresholdPanel({
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
			<StyledSelectInput
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
					Enter to apply · Shift+Tab back · Esc back
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// Notifications settings panel
export function SettingsNotificationsPanel({
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
			bell: false,
			events: {
				toolConfirmation: true,
				questionPrompt: true,
				generationComplete: true,
				triggeredRunComplete: true,
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
		| 'bell'
		| 'toolConfirmation'
		| 'questionPrompt'
		| 'generationComplete'
		| 'triggeredRunComplete';

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
				label: `  Terminal Bell: ${isOn(config.bell)}`,
				value: 'bell' as ToggleKey,
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
			{
				label: `  Triggered Run Complete: ${isOn(
					config.events?.triggeredRunComplete,
				)}`,
				value: 'triggeredRunComplete' as ToggleKey,
			},
		];
	}, [config]);

	const handleSelect = (item: {label: string; value: ToggleKey}) => {
		const next = {...config};
		if (item.value === 'enabled') {
			next.enabled = !next.enabled;
		} else if (item.value === 'sound') {
			next.sound = !next.sound;
		} else if (item.value === 'bell') {
			next.bell = !next.bell;
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
						Enter to toggle · Shift+Tab back · Esc back
					</Text>
				</Box>
			)}
			<StyledSelectInput items={items} onSelect={handleSelect} />
			{isNarrow && (
				<Box marginTop={0}>
					<Text color={colors.secondary}>
						Enter to apply · Shift+Tab back · Esc back
					</Text>
				</Box>
			)}
		</TitledBoxWithPreferences>
	);
}

// Display settings panel
export function SettingsDisplayPanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const {colors} = useTheme();

	const currentReasoningExpanded = getReasoningExpanded();
	const currentCompactToolDisplay = getCompactToolDisplay();
	const currentShowUsageFooter = getShowUsageFooter();

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	type ToggleKey =
		| 'reasoningExpanded'
		| 'compactToolDisplay'
		| 'showUsageFooter';

	const items: {label: string; value: ToggleKey}[] = useMemo(() => {
		const isOn = (val: boolean | undefined) => (val ? 'ON' : 'OFF');
		return [
			{
				label: `Show Thinking by default: ${isOn(currentReasoningExpanded)}`,
				value: 'reasoningExpanded' as ToggleKey,
			},
			{
				// compactToolDisplay=true means results are COMPACT, so
				// expansion is on exactly when the preference is false.
				label: `Expand Tool Results by default: ${isOn(!currentCompactToolDisplay)}`,
				value: 'compactToolDisplay' as ToggleKey,
			},
			{
				label: `Usage & Cost Footer: ${isOn(currentShowUsageFooter)}`,
				value: 'showUsageFooter' as ToggleKey,
			},
		];
	}, [
		currentReasoningExpanded,
		currentCompactToolDisplay,
		currentShowUsageFooter,
	]);

	const handleSelect = (item: {label: string; value: ToggleKey}) => {
		if (item.value === 'reasoningExpanded') {
			const newValue = !currentReasoningExpanded;
			updateReasoningExpanded(newValue);
		} else if (item.value === 'compactToolDisplay') {
			const newValue = !currentCompactToolDisplay;
			updateCompactToolDisplay(newValue);
		} else if (item.value === 'showUsageFooter') {
			// Applies to the next response, no restart needed - the footer is
			// read from preferences per message.
			updateShowUsageFooter(!currentShowUsageFooter);
		}
		onBack();
	};

	const title = isNarrow ? 'Display' : 'Display Settings';

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
						Enter to toggle · Shift+Tab back · Esc back
					</Text>
				</Box>
			)}
			<StyledSelectInput items={items} onSelect={handleSelect} />
			{isNarrow && (
				<Box marginTop={0}>
					<Text color={colors.secondary}>
						Enter to apply · Shift+Tab back · Esc back
					</Text>
				</Box>
			)}
		</TitledBoxWithPreferences>
	);
}

// Privacy settings panel
export function SettingsPrivacyPanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const {colors} = useTheme();

	const [enabled, setEnabled] = useState(getPrivacyPreference());

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	const items = useMemo(() => {
		return [
			{
				label: `Prompt Scrubbing: ${enabled ? 'ON' : 'OFF'}`,
				value: 'toggle',
			},
		];
	}, [enabled]);

	const handleSelect = () => {
		const next = !enabled;
		setEnabled(next);
		updatePrivacyPreference(next);
	};

	const title = isNarrow ? 'Privacy' : 'Privacy Settings';

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
						Enter to toggle · Shift+Tab back · Esc back
					</Text>
				</Box>
			)}

			<Box marginBottom={1}>
				<Text color={colors.warning}>
					Prompt Scrubbing removes sensitive identifiers before sending prompts
					to cloud providers. This improves privacy but does not guarantee
					semantic anonymity.
				</Text>
			</Box>

			<StyledSelectInput items={items} onSelect={handleSelect} />

			<Box marginTop={1}>
				<Text color={colors.secondary}>Enter to apply · Esc back</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

/** Presets cycled by the Advanced panel. Any value in range can still be set
 * directly in nanocoder-preferences.json; these are just the common choices. */
const TOKEN_BUDGET_PRESETS = [120, 240, 480, 960];
const MEMORY_LIMIT_PRESETS = [3, 5, 8, 12];

/** Next preset after `current`, wrapping. Falls to the first when `current`
 * is a hand-edited value that isn't in the list. */
function cyclePreset(presets: number[], current: number): number {
	const index = presets.indexOf(current);
	return presets[(index + 1) % presets.length] ?? presets[0] ?? current;
}

// Semantic memory settings panel
export function SettingsSemanticMemoryPanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const {colors} = useTheme();

	const initialContextPreferences = getProjectContextPreferences();
	const [semanticMemoryEnabled, setSemanticMemoryEnabled] = useState(
		initialContextPreferences.semanticMemoryEnabled,
	);
	const [tokenBudget, setTokenBudget] = useState(
		initialContextPreferences.tokenBudget,
	);
	const [memoryLimit, setMemoryLimit] = useState(
		initialContextPreferences.memoryLimit,
	);

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	const items = useMemo(() => {
		return [
			{
				label: `Semantic Memory: ${semanticMemoryEnabled ? 'ON' : 'OFF'}`,
				value: 'semantic-memory',
			},
			{
				label: `Memory Token Budget: ${tokenBudget}`,
				value: 'semantic-memory-token-budget',
			},
			{
				label: `Memories Per Prompt: ${memoryLimit}`,
				value: 'semantic-memory-limit',
			},
		];
	}, [semanticMemoryEnabled, tokenBudget, memoryLimit]);

	const handleSelect = (item: {value: string}) => {
		switch (item.value) {
			case 'semantic-memory': {
				const next = !semanticMemoryEnabled;
				setSemanticMemoryEnabled(next);
				updateSemanticMemoryEnabled(next);
				break;
			}
			case 'semantic-memory-token-budget': {
				const next = cyclePreset(TOKEN_BUDGET_PRESETS, tokenBudget);
				setTokenBudget(next);
				updateSemanticMemoryTokenBudget(next);
				break;
			}
			case 'semantic-memory-limit': {
				const next = cyclePreset(MEMORY_LIMIT_PRESETS, memoryLimit);
				setMemoryLimit(next);
				updateSemanticMemoryLimit(next);
				break;
			}
		}
	};

	const title = isNarrow ? 'Memory' : 'Semantic Memory';

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
						Enter to toggle · Shift+Tab back · Esc back
					</Text>
				</Box>
			)}

			<Box marginBottom={1}>
				<Text color={colors.warning}>
					Semantic Memory recalls saved project context and injects it into
					future prompts. Turn it off for stateless agent behavior. The budget
					and per-prompt count bound how much of the context window it may
					consume - lower them on small local models.
				</Text>
			</Box>

			<StyledSelectInput items={items} onSelect={handleSelect} />

			<Box marginTop={1}>
				<Text color={colors.secondary}>Enter to apply · Esc back</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
