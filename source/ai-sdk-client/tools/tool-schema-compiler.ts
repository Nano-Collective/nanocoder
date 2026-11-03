import type {AISDKCoreTool} from '@/types/index';
import {extractToolSchema} from './tool-schema-extract.js';

/**
 * Compile AI SDK tools into a JSON Schema for constrained generation.
 *
 * Takes a record of AI SDK tools and produces a JSON Schema that describes
 * valid tool calls. Local LLM backends (Ollama, vLLM, llama.cpp) use this
 * schema to constrain token generation, physically preventing invalid JSON,
 * hallucinated tool names, and incorrect parameter types.
 *
 * @param tools - Record of tool name → AI SDK tool definition
 * @returns JSON Schema object describing valid tool call structure, or undefined if no tools
 */
export function compileToolsToJsonSchema(
	tools: Record<string, AISDKCoreTool> | undefined,
): Record<string, unknown> | undefined {
	if (!tools || Object.keys(tools).length === 0) {
		return undefined;
	}

	// Build a schema that matches the OpenAI function calling format:
	// {
	//   "name": "tool_name",
	//   "arguments": { ...tool-specific params... }
	// }
	const toolSchemas: Record<string, unknown>[] = [];

	for (const [toolName, tool] of Object.entries(tools)) {
		const inputSchema = extractToolSchema(tool);

		// Each tool becomes a possible value in the schema
		const toolCallSchema: Record<string, unknown> = {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					const: toolName, // Enforce exact tool name
				},
				arguments: inputSchema || {type: 'object', properties: {}},
			},
			required: ['name', 'arguments'],
			additionalProperties: false,
		};

		toolSchemas.push(toolCallSchema);
	}

	// If there's only one tool, use it directly; otherwise create a oneOf union
	if (toolSchemas.length === 1) {
		return toolSchemas[0];
	}

	return {
		oneOf: toolSchemas,
	};
}
