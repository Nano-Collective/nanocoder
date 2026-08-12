import {Box, Text, useInput} from 'ink';
import {useState} from 'react';
import {StyledSelectInput} from '@/components/ui/styled-select-input';
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
	onMcpChanged,
}: {
	onBack: () => void;
	onCancel: () => void;
	onMcpChanged?: () => void | Promise<void>;
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
				onComplete={() => {
					// Rebuild the running session's MCP connections; otherwise a server
					// added here stays inert until the next launch.
					void onMcpChanged?.();
					onBack();
				}}
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
		{label: '+ Add or edit MCP servers…', value: 'edit'},
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
			<StyledSelectInput items={items} onSelect={() => setEditing(true)} />
			<Box marginTop={1}>
				<Text color={colors.secondary}>Shift+Tab back · Esc back</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
