import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {getColors} from '@/config/index';
import {ThemeContext} from '@/hooks/useTheme';
import {getActiveToolManager} from '@/tools/tool-manager';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {ensureString} from '@/utils/type-helpers';

export interface LoadToolSchemaArgs {
	tool_name: string;
}

export const executeLoadToolSchema = async (
	args: LoadToolSchemaArgs,
): Promise<string> => {
	const toolName = ensureString(args.tool_name).trim();

	if (!toolName) {
		return 'Error: tool_name cannot be empty. Specify an available MCP tool from the catalog.';
	}

	const manager = getActiveToolManager();
	if (!manager) {
		return 'Error: Tool manager is not active.';
	}

	const catalog = manager.getMcpCatalog();
	const entry = catalog.get(toolName);

	if (!entry) {
		const available = catalog
			.getUnloaded()
			.map(t => `\`${t.name}\` (${t.serverName})`)
			.join(', ');
		return `Tool "${toolName}" was not found in the MCP catalog. Available on-demand tools: ${available || 'none'}.`;
	}

	const loadSuccess = manager.loadMcpTool(toolName);
	if (!loadSuccess) {
		return `Failed to hydrate schema for tool "${toolName}".`;
	}

	// Format schema details for model context
	const schemaDetails: string[] = [
		`Successfully loaded tool "${toolName}" from server "${entry.serverName}".`,
		`Description: ${entry.description}`,
		entry.readOnly ? 'Mode: Read-only' : 'Mode: Mutating / execution',
		'',
		'Parameter Schema:',
	];

	if (entry.inputSchema && typeof entry.inputSchema === 'object') {
		const properties = (entry.inputSchema.properties || {}) as Record<
			string,
			{type?: string; description?: string}
		>;
		const required = new Set(
			Array.isArray(entry.inputSchema.required)
				? entry.inputSchema.required
				: [],
		);

		for (const [propName, propDef] of Object.entries(properties)) {
			const reqLabel = required.has(propName) ? ' (required)' : ' (optional)';
			const typeLabel = propDef.type ? ` [${propDef.type}]` : '';
			const desc = propDef.description ? `: ${propDef.description}` : '';
			schemaDetails.push(`- ${propName}${typeLabel}${reqLabel}${desc}`);
		}
	} else {
		schemaDetails.push('- No input parameters required.');
	}

	schemaDetails.push(
		'',
		`The tool "${toolName}" is now active in your tool registry. You can call it directly in subsequent steps.`,
	);

	return schemaDetails.join('\n');
};

const loadToolSchemaCoreTool = tool({
	description:
		'Inspect and dynamically load the full schema and parameter definitions for an on-demand MCP tool from the catalog, making it immediately available for execution.',
	inputSchema: jsonSchema<LoadToolSchemaArgs>({
		type: 'object',
		properties: {
			tool_name: {
				type: 'string',
				description:
					'The exact name of the MCP tool to load from the on-demand catalog (e.g. "execute_sql", "github_create_issue").',
			},
		},
		required: ['tool_name'],
		additionalProperties: false,
	}),
	execute: async args => {
		return await executeLoadToolSchema(args);
	},
});

function LoadToolSchemaComponent({
	args,
	result,
}: {
	args: LoadToolSchemaArgs;
	result?: string;
}) {
	const themeContext = React.useContext(ThemeContext);
	const colors = themeContext?.colors ?? getColors();
	const toolName = args.tool_name;

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>load_tool_schema</Text>
			<Box>
				<Text color={colors.secondary}>Target MCP Tool: </Text>
				<Text color="yellow">{toolName}</Text>
			</Box>
			{result && <Text color={colors.success}>{result}</Text>}
		</Box>
	);

	return <ToolMessage message={messageContent} hideBox={true} />;
}

const loadToolSchemaFormatter = async (
	args: LoadToolSchemaArgs,
	result?: string,
): Promise<React.ReactElement> => {
	return <LoadToolSchemaComponent args={args} result={result} />;
};

const loadToolSchemaValidator = async (
	args: LoadToolSchemaArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const toolName = ensureString(args.tool_name).trim();
	if (!toolName) {
		return {valid: false, error: 'tool_name is required'};
	}
	return {valid: true};
};

export const loadToolSchemaTool: NanocoderToolExport = {
	name: 'load_tool_schema' as const,
	tool: loadToolSchemaCoreTool,
	formatter: loadToolSchemaFormatter,
	validator: loadToolSchemaValidator,
	// Tool inspection is safe and non-mutating
	approval: () => false,
	readOnly: true,
};
