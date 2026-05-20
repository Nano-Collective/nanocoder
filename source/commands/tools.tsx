/**
 * /tools Command
 *
 * Lists every tool currently registered, grouped by source: built-in, MCP,
 * and custom (file-based). Lets users verify which tools the model has
 * access to in the current session.
 */

import {Box, Text} from 'ink';
import React from 'react';
import {InfoMessage} from '@/components/message-box';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {getToolManager} from '@/message-handler';
import {generateKey} from '@/session/key-generator';
import type {ToolManager} from '@/tools/tool-manager';
import type {Command} from '@/types/index';

interface GroupedTools {
	builtin: string[];
	mcp: Array<{name: string; server?: string}>;
	custom: Array<{name: string; source: 'personal' | 'project'}>;
}

function groupTools(toolManager: ToolManager): GroupedTools {
	const all = toolManager.getToolNames().sort();
	const builtin: string[] = [];
	const mcp: Array<{name: string; server?: string}> = [];
	const custom: Array<{name: string; source: 'personal' | 'project'}> = [];

	for (const name of all) {
		if (toolManager.isCustomTool(name)) {
			const info = toolManager.getCustomToolInfo(name);
			custom.push({name, source: info?.source ?? 'project'});
			continue;
		}
		const mcpInfo = toolManager.getMCPToolInfo(name);
		if (mcpInfo.isMCPTool) {
			mcp.push({name, server: mcpInfo.serverName});
			continue;
		}
		builtin.push(name);
	}
	return {builtin, mcp, custom};
}

function ToolsView({toolManager}: {toolManager: ToolManager | null}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	if (!toolManager) {
		return (
			<TitledBoxWithPreferences
				title="Tools"
				width={boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<Text color={colors.text}>Tool manager not yet initialized.</Text>
			</TitledBoxWithPreferences>
		);
	}

	const {builtin, mcp, custom} = groupTools(toolManager);
	const total = builtin.length + mcp.length + custom.length;

	return (
		<TitledBoxWithPreferences
			title={`Tools (${total})`}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.primary} bold>
					Built-in ({builtin.length})
				</Text>
			</Box>
			{builtin.length === 0 ? (
				<Text color={colors.secondary}>(none)</Text>
			) : (
				<Text color={colors.text}>{builtin.join(', ')}</Text>
			)}

			<Box marginTop={1} marginBottom={1}>
				<Text color={colors.primary} bold>
					MCP ({mcp.length})
				</Text>
			</Box>
			{mcp.length === 0 ? (
				<Text color={colors.secondary}>(none)</Text>
			) : (
				mcp.map(t => (
					<Text key={t.name} color={colors.text}>
						• {t.name}
						{t.server ? (
							<Text color={colors.secondary}> ({t.server})</Text>
						) : null}
					</Text>
				))
			)}

			<Box marginTop={1} marginBottom={1}>
				<Text color={colors.primary} bold>
					Custom ({custom.length})
				</Text>
			</Box>
			{custom.length === 0 ? (
				<>
					<Text color={colors.secondary}>(none)</Text>
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Drop a markdown file into{' '}
							<Text color={colors.primary}>.nanocoder/tools/</Text> to add one.
						</Text>
					</Box>
				</>
			) : (
				custom.map(t => (
					<Text key={t.name} color={colors.text}>
						• {t.name} <Text color={colors.secondary}>({t.source})</Text>
					</Text>
				))
			)}
		</TitledBoxWithPreferences>
	);
}

export const toolsCommand: Command = {
	name: 'tools',
	description:
		'List available tools (built-in, MCP, custom). Subcommand: create <name>',
	handler: (args, _messages, _metadata) => {
		// `create` is intercepted earlier in app-util.ts and dispatched to
		// handleToolCreate, but if a user reaches here with `create` and no
		// name (e.g. from a non-app context), show usage rather than a list.
		if (args[0] === 'create') {
			return Promise.resolve(
				React.createElement(InfoMessage, {
					key: generateKey('tools'),
					message:
						'Usage: /tools create <name>\nExample: /tools create k8s-pods\n\nThis creates a new custom tool file under .nanocoder/tools/ and starts an AI-assisted session to write its content.',
					hideBox: true,
				}),
			);
		}

		const toolManager = getToolManager();
		return Promise.resolve(
			React.createElement(ToolsView, {
				key: generateKey('tools'),
				toolManager,
			}),
		);
	},
};
