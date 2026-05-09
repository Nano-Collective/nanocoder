import type {AISDKCoreTool} from '@/types/index';

/**
 * Formats tool definitions for injection into the system prompt as JSON.
 * Used when native tool calling is disabled and JSON fallback is selected.
 * JSON-tuned models (Qwen, Kimi, GLM) emit JSON tool calls more reliably
 * than XML when given native-style JSON Schema definitions.
 */
export function formatToolsForJSONPrompt(
	tools: Record<string, AISDKCoreTool>,
): string {
	const toolNames = Object.keys(tools);

	if (toolNames.length === 0) {
		return '';
	}

	let prompt = '\n\n## AVAILABLE TOOLS\n\n';
	prompt +=
		'You have access to the following tools. To use a tool, output a JSON code block in this exact format:\n\n';
	prompt +=
		'```json\n{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}\n```\n\n';
	prompt += 'IMPORTANT:\n';
	prompt += '- Use the exact tool name in the "name" field\n';
	prompt += '- "arguments" must be a JSON object (not a string)\n';
	prompt += '- Always wrap each tool call in a ```json ... ``` fenced block\n';
	prompt += '- You may emit multiple tool-call blocks in sequence\n';
	prompt +=
		'- Do NOT use XML, function-calling syntax, or attribute-style tags\n\n';

	for (const name of toolNames) {
		const tool = tools[name];
		prompt += formatSingleTool(name, tool);
	}

	return prompt;
}

function formatSingleTool(name: string, tool: AISDKCoreTool): string {
	let output = `### ${name}\n\n`;

	const description = extractDescription(tool);
	if (description) {
		output += `${description}\n\n`;
	}

	const schema = extractInputSchema(tool);
	if (schema) {
		output += '**Input schema (JSON Schema):**\n';
		output += '```json\n';
		output += JSON.stringify(schema, null, 2);
		output += '\n```\n\n';

		const properties =
			(schema.properties as Record<
				string,
				{type?: string; description?: string}
			>) ?? {};
		const required = (schema.required as string[]) ?? [];

		const exampleParams =
			required.length > 0
				? required.slice(0, 2)
				: Object.keys(properties).slice(0, 2);

		if (exampleParams.length > 0) {
			const exampleArgs: Record<string, string> = {};
			for (const paramName of exampleParams) {
				exampleArgs[paramName] = 'value';
			}
			output += '**Example:**\n```json\n';
			output += JSON.stringify({name, arguments: exampleArgs}, null, 2);
			output += '\n```\n\n';
		}
	}

	return output;
}

function extractDescription(tool: AISDKCoreTool): string | undefined {
	if ('description' in tool && typeof tool.description === 'string') {
		return tool.description;
	}
	return undefined;
}

function extractInputSchema(
	tool: AISDKCoreTool,
): {properties?: unknown; required?: unknown} | undefined {
	if ('inputSchema' in tool && tool.inputSchema) {
		const schema = tool.inputSchema as {jsonSchema?: unknown};
		if (schema.jsonSchema) {
			return schema.jsonSchema as {properties?: unknown; required?: unknown};
		}
		return schema as {properties?: unknown; required?: unknown};
	}

	if ('parameters' in tool && tool.parameters) {
		const params = tool.parameters as {jsonSchema?: unknown};
		if (params.jsonSchema) {
			return params.jsonSchema as {properties?: unknown; required?: unknown};
		}
		return params as {properties?: unknown; required?: unknown};
	}

	return undefined;
}
