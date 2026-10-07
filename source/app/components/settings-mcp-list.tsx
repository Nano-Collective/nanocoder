import {Box, Text, useInput} from 'ink';
import {useState} from 'react';
import {StyledSelectInput} from '@/components/ui/styled-select-input';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getAppConfig} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {McpWizard} from '@/wizards/mcp-wizard';

/**
 * Lists the configured MCP servers first. Selecting a server opens the wizard on
 * that entry's edit/delete choice; the trailing row adds a new one.
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
	// null = not editing. '' = adding a new server (no entry targeted).
	const [editTarget, setEditTarget] = useState<string | null>(null);

	const servers = getAppConfig().mcpServers ?? [];

	useInput((_, key) => {
		if (editTarget !== null) return;
		if (key.escape) onBack();
		if (key.shift && key.tab) onBack();
	});

	if (editTarget !== null) {
		return (
			<McpWizard
				projectDir={process.cwd()}
				initialEditName={editTarget || undefined}
				onComplete={async () => {
					// Rebuild the running session's MCP connections; otherwise a server
					// added here stays inert until the next launch.
					await onMcpChanged?.();
					setEditTarget(null);
				}}
				onCancel={() => setEditTarget(null)}
			/>
		);
	}

	const items = [
		...servers.map(s => {
			const detail = s.command ? s.command : s.url ? s.url : '(no endpoint)';
			// Value is the server name so the wizard can target this entry.
			return {
				label: `${s.name}  ·  ${s.transport}  ·  ${detail}`,
				value: s.name,
			};
		}),
		{label: '+ Add an MCP server…', value: ''},
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
					Enter edits or deletes the selected server.
				</Text>
			</Box>
			<StyledSelectInput
				items={items}
				onSelect={item => setEditTarget(item.value)}
			/>
			<Box marginTop={1}>
				<Text color={colors.secondary}>Shift+Tab back · Esc back</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
