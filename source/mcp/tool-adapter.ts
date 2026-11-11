import {dynamicTool} from 'ai';
import type {
	AISDKCoreTool,
	MCPTool,
	StructuredToolOutput,
	Tool,
	ToolApprovalPolicy,
	ToolParameterSchema,
} from '@/types/index';
import {jsonSchema} from '@/types/index';
import {getToolJsonSchema} from '@/utils/schema-validate';
import {withValidation} from '@/utils/tool-validation';
import {ensureString} from '@/utils/type-helpers';

/**
 * Adapts discovered MCP tools to the shapes the rest of nanocoder consumes:
 * the legacy function-tool definition, the AI SDK tool, and the validated
 * handler registered with ToolManager.
 */

export type MCPToolHandler = (
	args: Record<string, unknown>,
) => Promise<string | StructuredToolOutput>;

export interface MCPToolEntry {
	name: string;
	tool: AISDKCoreTool;
	handler: MCPToolHandler;
	approval: ToolApprovalPolicy;
}

function describeTool(serverName: string, mcpTool: MCPTool): string {
	return mcpTool.description
		? `[MCP:${serverName}] ${mcpTool.description}`
		: `MCP tool from ${serverName}`;
}

/**
 * Convert an MCP tool to nanocoder's Tool format. Uses the original tool
 * name for better model compatibility.
 */
export function toFunctionTool(serverName: string, mcpTool: MCPTool): Tool {
	const schema = mcpTool.inputSchema;
	return {
		type: 'function',
		function: {
			name: mcpTool.name,
			description: describeTool(serverName, mcpTool),
			parameters: {
				type: 'object',
				properties: (schema?.properties || {}) as Record<
					string,
					ToolParameterSchema
				>,
				required: schema?.required || [],
			},
		},
	};
}

/**
 * Convert an MCP tool to the AI SDK's tool format. dynamicTool is more
 * explicit about unknown types compared to tool(): MCP schemas come from
 * external servers and are not known at compile time.
 */
export function toNativeTool(
	serverName: string,
	mcpTool: MCPTool,
	callTool: MCPToolHandler,
): AISDKCoreTool {
	return dynamicTool({
		description: describeTool(serverName, mcpTool),
		inputSchema: jsonSchema<Record<string, unknown>>(
			mcpTool.inputSchema || {type: 'object'},
		),
		execute: async (input, _options) => {
			// dynamicTool passes 'input' as unknown, validate at runtime
			const output = await callTool(input as Record<string, unknown>);
			return typeof output === 'string' ? output : output.llmContent;
		},
	});
}

/**
 * Run the same lenient schema type-check the approval prompt renders
 * (tool-confirmation → getToolJsonSchema), so a malformed call is rejected
 * locally — it never reaches the server, and approving a "wrong type" call
 * no longer silently skips the schema gate. No per-tool validator exists for
 * MCP; the server remains the authority on value constraints.
 */
export function createValidatedHandler(
	coreTool: AISDKCoreTool,
	callTool: MCPToolHandler,
): MCPToolHandler {
	return withValidation(
		callTool,
		undefined,
		getToolJsonSchema(coreTool),
		// The wrapper types its result as the generic
		// ToolExecuteResult union; MCP handlers only resolve a string
		// or a structured failure, so the narrower entry signature is
		// safe here.
	) as MCPToolHandler;
}

/**
 * If the schema expects a string but the model sent an object, stringify
 * it. Only coerces when the schema explicitly demands a string.
 */
export function coerceStringArguments(
	toolDef: MCPTool | undefined,
	args: Record<string, unknown>,
): Record<string, unknown> {
	const sanitizedArgs = {...args};

	if (toolDef?.inputSchema) {
		const schema = toolDef.inputSchema;
		if (schema.properties) {
			for (const [key, value] of Object.entries(args)) {
				const propSchema = schema.properties[key];
				if (
					typeof propSchema === 'object' &&
					propSchema?.type === 'string' &&
					typeof value === 'object' &&
					value !== null
				) {
					sanitizedArgs[key] = ensureString(value);
				}
			}
		}
	}

	return sanitizedArgs;
}
