import {Box, Text, useInput} from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import SelectInput from 'ink-select-input';
import {type ReactNode, useCallback, useMemo, useRef, useState} from 'react';
import type {TitleShape} from '@/components/ui/styled-title';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {
	getNanocoderShape,
	getNotificationsPreference,
	getPasteThreshold,
	updateNanocoderShape,
	updateNotificationsPreference,
	updatePasteThreshold,
	updateSelectedTheme,
} from '@/config/preferences';
import {getThemeColors, themes} from '@/config/themes';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {useTitleShape} from '@/hooks/useTitleShape';
import type {NotificationsConfig} from '@/types/config';
import type {NanocoderShape, ThemePreset} from '@/types/ui';
import {setNotificationsConfig} from '@/utils/notifications';
import {DEFAULT_SINGLE_LINE_PASTE_THRESHOLD} from '@/utils/paste-utils';
import {SettingsAutoCompactPanel} from './settings-auto-compact';
import {SettingsDefaultModePanel} from './settings-default-mode';
import type {ChangeDiff} from './settings-keep-discard-prompt';
import {KeepDiscardPrompt} from './settings-keep-discard-prompt';
import {
	buildBreadcrumbTitle,
	CATEGORIES,
	childPath,
	type DirtyState,
	getCategoryByKey,
	getItemsForCategory,
	isRootPath,
	parentPath,
	ROOT_PATH,
	type SettingsCategory,
	type SettingsPath,
} from './settings-menu-types';
import {SettingsReasoningTracesPanel} from './settings-reasoning-traces';
import {SettingsSessionsPanel} from './settings-sessions';
import {SettingsToolApprovalPanel} from './settings-tool-approval';
import {SettingsWebSearchPanel} from './settings-web-search';

// ─── Props ───────────────────────────────────────────────────────────────────

interface SettingsSelectorProps {
	onCancel: () => void;
}

// ─── Top-Level Settings Menu ─────────────────────────────────────────────────

function SettingsTopLevelMenu({
	onNavigate,
	onCancel,
}: {
	onNavigate: (path: SettingsPath) => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	useInput((_input, key) => {
		if (key.escape) {
			onCancel();
		}
	});

	const handleSelect = (item: {value: SettingsCategory}) => {
		onNavigate(childPath(ROOT_PATH, item.value));
	};

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
					items={CATEGORIES.map(cat => ({
						label: cat.label,
						value: cat.key,
					}))}
					onSelect={handleSelect}
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
				<Text color={colors.secondary}>Enter to select · Esc to exit</Text>
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
				<Text color={colors.secondary}>Select a category:</Text>
			</Box>
			<SelectInput
				items={CATEGORIES.map(cat => ({
					label: `${cat.label} — ${cat.description}`,
					value: cat.key,
				}))}
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
			<Box marginTop={1}>
				<Text color={colors.secondary}>Enter to select, Esc to exit</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// ─── Category Sub-Menu ───────────────────────────────────────────────────────

function SettingsCategoryMenu({
	category,
	path,
	onNavigate,
	onBack,
	onCancel,
}: {
	category: SettingsCategory;
	path: SettingsPath;
	onNavigate: (path: SettingsPath) => void;
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const categoryDef = getCategoryByKey(category);
	const items = getItemsForCategory(category);

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	// If the category has no items (e.g. environment), render the direct panel
	if (items.length === 0) {
		// Navigate directly to the category panel
		return (
			<SettingsCategoryPanel
				category={category}
				path={path}
				onNavigate={onNavigate}
				onBack={onBack}
				onCancel={onCancel}
			/>
		);
	}

	const handleSelect = (item: {value: string}) => {
		onNavigate(childPath(path, item.value));
	};

	const breadcrumb = buildBreadcrumbTitle(path);

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
					{breadcrumb}
				</Text>
				<Text color={colors.text}> </Text>
				<SelectInput
					items={items.map(item => ({
						label: item.label,
						value: item.key,
					}))}
					onSelect={handleSelect}
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
				<Text color={colors.secondary}>
					Enter to select · Shift+Tab back · Esc to exit
				</Text>
			</Box>
		);
	}

	return (
		<TitledBoxWithPreferences
			title={breadcrumb}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={1}
			paddingY={1}
			flexDirection="column"
		>
			{categoryDef?.warning && (
				<Box marginBottom={1}>
					<Text color={colors.warning} bold>
						⚠ {categoryDef.warning}
					</Text>
				</Box>
			)}
			<Box marginBottom={1}>
				<Text color={colors.secondary}>Select a setting to configure:</Text>
			</Box>
			<SelectInput
				items={items.map(item => ({
					label: `${item.label} — ${item.description}`,
					value: item.key,
				}))}
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
			<Box marginTop={1}>
				<Text color={colors.secondary}>
					Enter to select, Shift+Tab to go back, Esc to exit
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// ─── Category Panel Router ───────────────────────────────────────────────────
// For categories that render directly (no sub-items), or as a placeholder
// until individual panels are implemented.

function SettingsCategoryPanel({
	category,
	path,
	onNavigate,
	onBack,
	onCancel,
}: {
	category: SettingsCategory;
	path: SettingsPath;
	onNavigate: (path: SettingsPath) => void;
	onBack: () => void;
	onCancel: () => void;
}) {
	// For now, environment renders directly; others fall through to item panels
	if (category === 'environment') {
		return <SettingsEnvironmentPanel onBack={onBack} onCancel={onCancel} />;
	}

	// Fallback: shouldn't happen for categories with items
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const breadcrumb = buildBreadcrumbTitle(path);

	return (
		<TitledBoxWithPreferences
			title={breadcrumb}
			width={isNarrow ? '100%' : boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Text color={colors.secondary}>
				No settings available in this category yet.
			</Text>
			<Box marginTop={1}>
				<Text color={colors.secondary}>Shift+Tab to go back, Esc to exit</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// ─── Environment Panel (Read-Only) ───────────────────────────────────────────

function SettingsEnvironmentPanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const envVars = useMemo(() => {
		const nanocoderVars: {key: string; value: string; masked: boolean}[] = [];
		const sensitivePatterns = ['KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'AUTH'];

		for (const [key, value] of Object.entries(process.env)) {
			if (key.startsWith('NANOCODER_') && typeof value === 'string') {
				const isSensitive = sensitivePatterns.some(pattern =>
					key.toUpperCase().includes(pattern),
				);
				nanocoderVars.push({
					key,
					value: isSensitive ? value.replace(/./g, '•') : value,
					masked: isSensitive,
				});
			}
		}
		nanocoderVars.sort((a, b) => a.key.localeCompare(b.key));
		return nanocoderVars;
	}, []);

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	const title = isNarrow ? 'Environment' : 'Settings · Environment';

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
					{title}
				</Text>
				<Text color={colors.secondary}>
					Read-only · {envVars.length} variables
				</Text>
				{envVars.length === 0 && (
					<Text color={colors.text}>No NANOCODER_* env vars detected.</Text>
				)}
				{envVars.map(({key, value, masked}) => (
					<Box key={key}>
						<Text color={colors.tool} bold>
							{key}
						</Text>
						<Text color={colors.text}> = </Text>
						<Text color={masked ? colors.warning : colors.text}>
							{value || '(empty)'}
						</Text>
					</Box>
				))}
				<Box marginBottom={1}></Box>
				<Text color={colors.secondary}>Shift+Tab back · Esc to exit</Text>
			</Box>
		);
	}

	return (
		<TitledBoxWithPreferences
			title={title}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Active NANOCODER_* environment variables (read-only). {envVars.length}{' '}
					variable{envVars.length !== 1 ? 's' : ''} detected.
				</Text>
			</Box>
			{envVars.length === 0 && (
				<Text color={colors.text}>No NANOCODER_* env vars detected.</Text>
			)}
			{envVars.map(({key, value, masked}) => (
				<Box key={key} flexDirection="row">
					<Text color={colors.tool} bold>
						{key}
					</Text>
					<Text color={colors.text}> = </Text>
					<Text color={masked ? colors.warning : colors.text}>
						{value || '(empty)'}
					</Text>
					{masked && <Text color={colors.secondary}> (masked)</Text>}
				</Box>
			))}
			<Box marginTop={1}>
				<Text color={colors.secondary}>Shift+Tab to go back, Esc to exit</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// ─── Theme Preview Components ────────────────────────────────────────────────

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

// ─── Theme Settings Panel ────────────────────────────────────────────────────

function SettingsThemePanel({
	onBack,
	onCancel,
	onChanged,
}: {
	onBack: () => void;
	onCancel: () => void;
	onChanged?: (diff: ChangeDiff) => void;
}) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const {currentTheme, setCurrentTheme} = useTheme();
	const [originalTheme] = useState(currentTheme);

	const themeList = Object.values(themes);
	const [currentIndex, setCurrentIndex] = useState(() => {
		const index = themeList.findIndex(theme => theme.name === currentTheme);
		return index >= 0 ? index : 0;
	});

	const previewTheme = themeList[currentIndex];
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
			onChanged?.({
				setting: 'Theme',
				oldValue: originalTheme,
				newValue: previewTheme.name,
			});
			setCurrentTheme(previewTheme.name as ThemePreset);
			updateSelectedTheme(previewTheme.name as ThemePreset);
			onBack();
		}
	});

	const themeName = `${previewTheme.displayName} [${
		currentIndex + 1
	}/${themeList.length}]`;
	const isCurrentTheme = previewTheme.name === originalTheme;

	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title="Settings · Theme"
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
					↑↓ navigate · Enter select · Esc exit
				</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Settings · Theme"
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
					↑↓ navigate · Enter apply · Shift+Tab back · Esc exit
				</Text>
			</Box>

			<ThemeMiniPreview colors={previewColors} />
		</TitledBoxWithPreferences>
	);
}

// ─── Title Shape Settings Panel ──────────────────────────────────────────────

function SettingsTitleShapePanel({
	onBack,
	onCancel,
	onChanged,
}: {
	onBack: () => void;
	onCancel: () => void;
	onChanged?: (diff: ChangeDiff) => void;
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
		onChanged?.({
			setting: 'Title Shape',
			oldValue: originalShape,
			newValue: item.value,
		});
		setCurrentTitleShape(item.value);
		onBack();
	};

	const handleHighlight = (item: {label: string; value: TitleShape}) => {
		setCurrentTitleShape(item.value);
	};

	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title="Settings · Title Shape"
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
			title="Settings · Title Shape"
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

// ─── Nanocoder Shape Settings Panel ──────────────────────────────────────────

function SettingsNanocoderShapePanel({
	onBack,
	onCancel,
	onChanged,
}: {
	onBack: () => void;
	onCancel: () => void;
	onChanged?: (diff: ChangeDiff) => void;
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
		onChanged?.({
			setting: 'Nanocoder Shape',
			oldValue: originalShape,
			newValue: item.value,
		});
		updateNanocoderShape(item.value);
		onBack();
	};

	const handleHighlight = (item: {label: string; value: NanocoderShape}) => {
		setPreviewShape(item.value);
	};

	const displayText = isNarrow ? 'NC' : 'Nanocoder';

	if (isNarrow) {
		return (
			<>
				<Gradient colors={[colors.primary, colors.tool]}>
					<BigText text={displayText} font={previewShape} />
				</Gradient>
				<TitledBoxWithPreferences
					title="Settings · Nanocoder Shape"
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
				title="Settings · Nanocoder Shape"
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

// ─── Paste Threshold Settings Panel ──────────────────────────────────────────

function SettingsPasteThresholdPanel({
	onBack,
	onCancel,
	onChanged,
}: {
	onBack: () => void;
	onCancel: () => void;
	onChanged?: (diff: ChangeDiff) => void;
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
		return index >= 0 ? index : 3;
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
		onChanged?.({
			setting: 'Paste Threshold',
			oldValue: String(currentThreshold),
			newValue: String(item.value),
		});
		updatePasteThreshold(item.value);
		onBack();
	};

	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title="Settings · Paste Threshold"
				width="100%"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<Text color={colors.secondary}>Current: {currentThreshold}</Text>
				<SelectInput
					items={thresholdOptions.map(opt => ({
						label:
							opt.value === currentThreshold ? `${opt.label} *` : opt.label,
						value: opt.value,
					}))}
					initialIndex={initialIndex}
					onSelect={handleSelect}
				/>
				<Box marginTop={0}>
					<Text color={colors.secondary}>Enter/Shift+Tab/Esc</Text>
				</Box>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Settings · Paste Threshold"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Single-line pastes above this limit become placeholders. Current:{' '}
					{currentThreshold} chars
				</Text>
			</Box>
			<SelectInput
				items={thresholdOptions.map(opt => ({
					label:
						opt.value === currentThreshold
							? `${opt.label} (current)`
							: opt.label,
					value: opt.value,
				}))}
				initialIndex={initialIndex}
				onSelect={handleSelect}
			/>
			<Box marginTop={1}>
				<Text color={colors.secondary}>
					Enter to apply, Shift+Tab to go back, Esc to exit
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// ─── Notifications Settings Panel ────────────────────────────────────────────

function SettingsNotificationsPanel({
	onBack,
	onCancel,
	onChanged,
}: {
	onBack: () => void;
	onCancel: () => void;
	onChanged?: (diff: ChangeDiff) => void;
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
		const prev = {...config};
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

		// Report the change
		const settingName =
			item.value === 'enabled'
				? 'Notifications'
				: item.value === 'sound'
					? 'Notification Sound'
					: `Notification: ${item.value}`;
		const getVal = (cfg: NotificationsConfig, key: ToggleKey) => {
			if (key === 'enabled') return String(cfg.enabled);
			if (key === 'sound') return String(cfg.sound);
			return String(cfg.events?.[key]);
		};
		onChanged?.({
			setting: settingName,
			oldValue: getVal(prev, item.value),
			newValue: getVal(next, item.value),
		});
	};

	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title="Settings · Notifications"
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
				<Box marginTop={0}>
					<Text color={colors.secondary}>Enter/Shift+Tab/Esc</Text>
				</Box>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Settings · Notifications"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Toggle settings with Enter. Shift+Tab to go back, Esc to exit
				</Text>
			</Box>
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
		</TitledBoxWithPreferences>
	);
}

// ─── Panel Router ────────────────────────────────────────────────────────────
// Routes a leaf-level path segment to the correct panel component.

function SettingsPanelRouter({
	category,
	panelKey,
	path,
	onNavigate,
	onBack,
	onCancel,
	onChanged,
}: {
	category: SettingsCategory;
	panelKey: string;
	path: SettingsPath;
	onNavigate: (path: SettingsPath) => void;
	onBack: () => void;
	onCancel: () => void;
	onChanged?: (diff: ChangeDiff) => void;
}) {
	// Appearance panels
	if (category === 'appearance') {
		switch (panelKey) {
			case 'theme':
				return (
					<SettingsThemePanel
						onBack={onBack}
						onCancel={onCancel}
						onChanged={onChanged}
					/>
				);
			case 'title-shape':
				return (
					<SettingsTitleShapePanel
						onBack={onBack}
						onCancel={onCancel}
						onChanged={onChanged}
					/>
				);
			case 'nanocoder-shape':
				return (
					<SettingsNanocoderShapePanel
						onBack={onBack}
						onCancel={onCancel}
						onChanged={onChanged}
					/>
				);
		}
	}

	// Input panels
	if (category === 'input') {
		switch (panelKey) {
			case 'paste-threshold':
				return (
					<SettingsPasteThresholdPanel
						onBack={onBack}
						onCancel={onCancel}
						onChanged={onChanged}
					/>
				);
		}
	}

	// Behavior panels
	if (category === 'behavior') {
		switch (panelKey) {
			case 'notifications':
				return (
					<SettingsNotificationsPanel
						onBack={onBack}
						onCancel={onCancel}
						onChanged={onChanged}
					/>
				);
			case 'auto-compact':
				return (
					<SettingsAutoCompactPanel
						onBack={onBack}
						onCancel={onCancel}
						onChanged={onChanged}
					/>
				);
			case 'sessions':
				return (
					<SettingsSessionsPanel
						onBack={onBack}
						onCancel={onCancel}
						onChanged={onChanged}
					/>
				);
			case 'default-mode':
				return (
					<SettingsDefaultModePanel
						onBack={onBack}
						onCancel={onCancel}
						onChanged={onChanged}
					/>
				);
			case 'reasoning-traces':
				return (
					<SettingsReasoningTracesPanel
						onBack={onBack}
						onCancel={onCancel}
						onChanged={onChanged}
					/>
				);
			default:
				return (
					<SettingsPlaceholderPanel
						panelKey={panelKey}
						onBack={onBack}
						onCancel={onCancel}
					/>
				);
		}
	}

	// Providers panels
	if (category === 'providers') {
		switch (panelKey) {
			case 'tool-approval':
				return (
					<SettingsToolApprovalPanel onBack={onBack} onCancel={onCancel} />
				);
			default:
				return (
					<SettingsPlaceholderPanel
						panelKey={panelKey}
						onBack={onBack}
						onCancel={onCancel}
					/>
				);
		}
	}

	// MCP panels
	if (category === 'mcp') {
		return (
			<SettingsPlaceholderPanel
				panelKey={panelKey}
				onBack={onBack}
				onCancel={onCancel}
			/>
		);
	}

	// Web Search panels
	if (category === 'webSearch') {
		switch (panelKey) {
			case 'api-key':
				return (
					<SettingsWebSearchPanel
						onBack={onBack}
						onCancel={onCancel}
						onChanged={onChanged}
					/>
				);
			default:
				return (
					<SettingsPlaceholderPanel
						panelKey={panelKey}
						onBack={onBack}
						onCancel={onCancel}
					/>
				);
		}
	}

	// Advanced panels
	if (category === 'advanced') {
		return (
			<SettingsPlaceholderPanel
				panelKey={panelKey}
				onBack={onBack}
				onCancel={onCancel}
			/>
		);
	}

	// Fallback
	return (
		<SettingsPlaceholderPanel
			panelKey={panelKey}
			onBack={onBack}
			onCancel={onCancel}
		/>
	);
}

// ─── Placeholder Panel ───────────────────────────────────────────────────────

function SettingsPlaceholderPanel({
	panelKey,
	onBack,
	onCancel,
}: {
	panelKey: string;
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const label = panelKey
		.replace(/[-_](.)/g, (_m, c) => c.toUpperCase())
		.replace(/^./, s => s.toUpperCase());

	useInput((_, key) => {
		if (key.escape) onCancel();
		if (key.shift && key.tab) onBack();
	});

	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title={`${label}`}
				width="100%"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<Text color={colors.secondary}>
					Coming soon — this setting is not yet implemented.
				</Text>
				<Box marginBottom={1}></Box>
				<Text color={colors.secondary}>Shift+Tab back · Esc to exit</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title={`${label}`}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Text color={colors.secondary}>
				Coming soon — this setting is not yet implemented.
			</Text>
			<Box marginTop={1}>
				<Text color={colors.secondary}>Shift+Tab to go back, Esc to exit</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// ─── Main Settings Selector ──────────────────────────────────────────────────

export function SettingsSelector({onCancel}: SettingsSelectorProps) {
	const [path, setPath] = useState<SettingsPath>(ROOT_PATH);
	const [dirtyState, setDirtyState] = useState<DirtyState | null>(null);
	// Accumulates change diffs as panels report them
	const changesRef = useRef<ChangeDiff[]>([]);

	// Callback for panels to report a change
	const reportChange = useCallback((diff: ChangeDiff) => {
		changesRef.current.push(diff);
	}, []);

	// Navigate to a new path
	const navigate = useCallback((newPath: SettingsPath) => {
		setPath(newPath);
	}, []);

	// Go back one level
	const goBack = useCallback(() => {
		setPath(currentPath => {
			const newParent = parentPath(currentPath);

			// If going back to root, check for dirty state
			if (isRootPath(newParent) && !isRootPath(currentPath)) {
				const categorySegment = currentPath[1] as SettingsCategory;
				const changes = changesRef.current;

				if (changes.length > 0) {
					setDirtyState({
						isDirty: true,
						category: categorySegment,
						changes: [...changes],
					});
				}
			} else {
				setDirtyState(null);
			}

			return newParent;
		});
	}, []);

	// Handle Keep/Discard
	const handleKeep = useCallback(() => {
		// Changes are already persisted by individual panels
		changesRef.current = [];
		setDirtyState(null);
		setPath(ROOT_PATH);
	}, []);

	const handleDiscard = useCallback(() => {
		// For Appearance settings that preview live, reload from preferences.
		// For other categories, changes were already saved on apply.
		changesRef.current = [];
		setDirtyState(null);
		setPath(ROOT_PATH);
	}, []);

	// If dirty state is active, show the Keep/Discard prompt
	if (dirtyState?.isDirty) {
		return (
			<KeepDiscardPrompt
				onKeep={handleKeep}
				onDiscard={handleDiscard}
				changes={dirtyState.changes}
			/>
		);
	}

	// Render based on current path depth
	if (isRootPath(path)) {
		return <SettingsTopLevelMenu onNavigate={navigate} onCancel={onCancel} />;
	}

	// Category level (depth 2): ['settings', 'appearance']
	if (path.length === 2) {
		const category = path[1] as SettingsCategory;
		return (
			<SettingsCategoryMenu
				category={category}
				path={path}
				onNavigate={navigate}
				onBack={goBack}
				onCancel={onCancel}
			/>
		);
	}

	// Panel level (depth 3): ['settings', 'appearance', 'theme']
	if (path.length === 3) {
		const category = path[1] as SettingsCategory;
		const panelKey = path[2];
		return (
			<SettingsPanelRouter
				category={category}
				panelKey={panelKey}
				path={path}
				onNavigate={navigate}
				onBack={goBack}
				onCancel={onCancel}
				onChanged={reportChange}
			/>
		);
	}

	// Fallback — shouldn't happen
	return <SettingsTopLevelMenu onNavigate={navigate} onCancel={onCancel} />;
}
