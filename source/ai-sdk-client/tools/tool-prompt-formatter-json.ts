import type {AISDKCoreTool} from '@/types/index';
import {
	extractToolDescription,
	extractToolSchema,
	selectExampleParamNames,
} from './tool-schema-extract.js';

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

	const description = extractToolDescription(tool);
	if (description) {
		output += `${description}\n\n`;
	}

	const schema = extractToolSchema(tool);
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

		const exampleParams = selectExampleParamNames(properties, required);

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
