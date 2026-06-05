import type {AISDKCoreTool} from '@/types/index';
import {
	extractToolDescription,
	extractToolSchema,
	selectExampleParamNames,
} from './tool-schema-extract.js';

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
	const description = extractToolDescription(tool);
	if (description) {
		output += `${description}\n\n`;
	}

	// Extract and format parameters
	const schema = extractToolSchema(tool);
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

		// Add example usage — prefer required params, fall back to any params
		const exampleParams = selectExampleParamNames(properties, required);
		output += '**Example:**\n```xml\n';
		output += `<${name}>\n`;
		for (const paramName of exampleParams) {
			output += `<${paramName}>value</${paramName}>\n`;
		}
		output += `</${name}>\n`;
		output += '```\n\n';
	}

	return output;
}
