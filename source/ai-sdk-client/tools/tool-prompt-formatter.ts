import type {AISDKCoreTool} from '@/types/index';

/**
 * Formats tool definitions for injection into the system prompt
 * Used when native tool calling is disabled but we still want the model
 * to be able to call tools via XML format
 */
export function formatToolsForPrompt(
	tools: Record<string, AISDKCoreTool>,
): string {
	const toolNames = Object.keys(tools);

	if (toolNames.length === 0) {
		return '';
	}

	let prompt = '\n\n## AVAILABLE TOOLS\n\n';
	prompt +=
		'You have access to the following tools. To use a tool, output an XML block in this exact format:\n\n';
	prompt +=
		'```xml\n<tool_name>\n<param1>value1</param1>\n<param2>value2</param2>\n</tool_name>\n```\n\n';
	prompt += 'IMPORTANT:\n';
	prompt += '- Use the exact tool name as the outer XML tag\n';
	prompt += '- Each parameter should be its own XML tag inside\n';
	prompt +=
		'- Do NOT use attributes like <function=name> or <parameter=name>\n';
	prompt += '- You may call multiple tools in sequence\n\n';

	for (const name of toolNames) {
		const tool = tools[name];
		prompt += formatSingleTool(name, tool);
	}

	return prompt;
}

/**
 * Formats a single tool definition
 */
function formatSingleTool(name: string, tool: AISDKCoreTool): string {
	let output = `### ${name}\n\n`;

	// Extract description from tool
	const description = extractDescription(tool);
	if (description) {
		output += `${description}\n\n`;
	}

	// Extract and format parameters
	const schema = extractInputSchema(tool);
	if (schema && schema.properties) {
		output += '**Parameters:**\n';

		const properties = schema.properties as Record<
			string,
			{type?: string; description?: string}
		>;
		const required = (schema.required as string[]) || [];

		for (const [paramName, paramSchema] of Object.entries(properties)) {
			const isRequired = required.includes(paramName);
			const typeStr = paramSchema.type || 'any';
			const reqStr = isRequired ? '(required)' : '(optional)';
			const descStr = paramSchema.description || '';

			output += `- \`${paramName}\` (${typeStr}) ${reqStr}: ${descStr}\n`;
		}

		output += '\n';

		// Add example usage
		output += '**Example:**\n```xml\n';
		output += `<${name}>\n`;
		for (const paramName of required.slice(0, 2)) {
			// Show first 2 required params
			output += `<${paramName}>value</${paramName}>\n`;
		}
		output += `</${name}>\n`;
		output += '```\n\n';
	}

	return output;
}

/**
 * Extracts description from AI SDK tool
 */
function extractDescription(tool: AISDKCoreTool): string | undefined {
	// AI SDK tools have description at the top level
	if ('description' in tool && typeof tool.description === 'string') {
		return tool.description;
	}
	return undefined;
}

/**
 * Extracts input schema from AI SDK tool
 */
function extractInputSchema(
	tool: AISDKCoreTool,
): {properties?: unknown; required?: unknown} | undefined {
	// AI SDK v6 tools use inputSchema (from jsonSchema())
	if ('inputSchema' in tool && tool.inputSchema) {
		const schema = tool.inputSchema as {jsonSchema?: unknown};
		// jsonSchema() wraps the schema, so we need to unwrap it
		if (schema.jsonSchema) {
			return schema.jsonSchema as {properties?: unknown; required?: unknown};
		}
		return schema as {properties?: unknown; required?: unknown};
	}

	// Fallback: check for parameters (older format)
	if ('parameters' in tool && tool.parameters) {
		const params = tool.parameters as {jsonSchema?: unknown};
		if (params.jsonSchema) {
			return params.jsonSchema as {properties?: unknown; required?: unknown};
		}
		return params as {properties?: unknown; required?: unknown};
	}

	return undefined;
}
