import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useMemo, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getAppConfig} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

interface SettingsToolApprovalPanelProps {
	onBack: () => void;
	onCancel: () => void;
}

type ListType = 'topLevel' | 'nanocoderTools';

export function SettingsToolApprovalPanel({
	onBack,
	onCancel,
}: SettingsToolApprovalPanelProps) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const appConfig = getAppConfig();
	const topLevelAllow = appConfig.alwaysAllow ?? [];
	const nanocoderToolsAllow = appConfig.nanocoderTools?.alwaysAllow ?? [];

	const [activeList] = useState<ListType>('topLevel');

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	const items = useMemo(() => {
		const currentList =
			activeList === 'topLevel' ? topLevelAllow : nanocoderToolsAllow;
		const listLabel =
			activeList === 'topLevel'
				? 'Top-level alwaysAllow'
				: 'Nanocoder tools alwaysAllow';

		const result: {label: string; value: string}[] = [
			{
				label: `Viewing: ${listLabel} (${currentList.length} tools)`,
				value: 'info',
			},
		];

		for (const tool of currentList) {
			result.push({
				label: `  ${tool}`,
				value: tool,
			});
		}

		if (currentList.length === 0) {
			result.push({
				label: '  (no tools configured)',
				value: 'empty',
			});
		}

		return result;
	}, [activeList, topLevelAllow, nanocoderToolsAllow]);

	const handleSelect = (_item: {value: string}) => {
		// For now, just informational display
		// Future: allow adding/removing tools
	};

	const title = isNarrow ? 'Tool Approval' : 'Settings · Tool Auto-Approval';

	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title={title}
				width="100%"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<SelectInput items={items} onSelect={handleSelect} />
				<Box marginBottom={1}></Box>
				<Text color={colors.secondary}>Shift+Tab back · Esc to exit</Text>
			</TitledBoxWithPreferences>
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
					Tools listed here run without confirmation. Edit agents.config.json to
					modify.
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
			<Box marginTop={1}>
				<Text color={colors.secondary}>Shift+Tab to go back, Esc to exit</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
