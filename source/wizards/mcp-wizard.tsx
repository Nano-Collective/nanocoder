import {Box, Text} from 'ink';
import {getColors} from '@/config/index';
import {BaseConfigWizard} from './base-config-wizard';
import {McpStep} from './steps/mcp-step';
import type {McpServerConfig} from './templates/mcp-templates';
import {buildMcpConfigObject} from './validation';

interface McpWizardProps {
	projectDir: string;
	onComplete: (configPath: string) => void;
	onCancel?: () => void;
}

type McpServers = Record<string, McpServerConfig>;

function parseMcpConfig(raw: unknown): McpServers {
	const config = raw as {mcpServers?: McpServers} | null;
	return config?.mcpServers ?? {};
}

function McpSummaryItems({items}: {items: McpServers}) {
	const colors = getColors();
	const entries = Object.entries(items);

	if (entries.length === 0) {
		return (
			<Box marginBottom={1}>
				<Text color={colors.warning}>No MCP servers configured</Text>
			</Box>
		);
	}

	return (
		<Box marginBottom={1} flexDirection="column">
			<Text color={colors.secondary}>MCP Servers ({entries.length}):</Text>
			{entries.map(([key, server]) => (
				<Text key={key} color={colors.success}>
					• {server.name} ({server.transport})
				</Text>
			))}
		</Box>
	);
}

export function McpWizard({projectDir, onComplete, onCancel}: McpWizardProps) {
	return (
		<BaseConfigWizard<McpServers>
			title="MCP Server Configuration"
			focusId="mcp-wizard"
			configFileName=".mcp.json"
			initialItems={{}}
			parseConfig={parseMcpConfig}
			buildConfig={buildMcpConfigObject}
			hasItems={items => Object.keys(items).length > 0}
			renderConfigureStep={({
				items,
				onComplete: onItemsComplete,
				onBack,
				onDelete,
				configExists,
			}) => (
				<McpStep
					existingServers={items}
					onComplete={onItemsComplete}
					onBack={onBack}
					onDelete={onDelete}
					configExists={configExists}
				/>
			)}
			renderSummaryItems={items => <McpSummaryItems items={items} />}
			projectDir={projectDir}
			onComplete={onComplete}
			onCancel={onCancel}
		/>
	);
}
