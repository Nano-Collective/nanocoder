import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getAppConfig} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {McpWizard} from '@/wizards/mcp-wizard';

/**
 * Lists the configured MCP servers first, then opens the existing MCP wizard to
 * add/edit rather than jumping straight into it.
 */
export function SettingsMcpListPanel({
	onBack,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const [editing, setEditing] = useState(false);

	const servers = getAppConfig().mcpServers ?? [];

	useInput((_, key) => {
		if (editing) return;
		if (key.escape) onBack();
		if (key.shift && key.tab) onBack();
	});

	if (editing) {
		return (
			<McpWizard
				projectDir={process.cwd()}
				onComplete={onBack}
				onCancel={() => setEditing(false)}
			/>
		);
	}

	const items = [
		...servers.map((s, i) => {
			const detail = s.command ? s.command : s.url ? s.url : '(no endpoint)';
			return {
				label: `${s.name}  ·  ${s.transport}  ·  ${detail}`,
				value: String(i),
			};
		}),
		{label: '＋ Add or edit MCP servers…', value: 'edit'},
	];

	return (
		<TitledBoxWithPreferences
			title="Settings · MCP Servers"
			width={isNarrow ? '100%' : boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					{servers.length} server{servers.length === 1 ? '' : 's'} configured.
					Enter opens the wizard to add or edit.
				</Text>
			</Box>
			<SelectInput
				items={items}
				onSelect={() => setEditing(true)}
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
				<Text color={colors.secondary}>Shift+Tab back · Esc exit</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
