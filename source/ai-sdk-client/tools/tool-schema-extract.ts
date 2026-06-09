import type {AISDKCoreTool} from '@/types/index';

/**
 * Shared helpers for reading description / JSON Schema off an AI SDK tool when
 * building system-prompt tool definitions. Used by both the XML and JSON
 * prompt formatters so the extraction logic lives in one place.
 */

export type ToolInputSchema = {properties?: unknown; required?: unknown};

/**
 * Extracts the top-level description from an AI SDK tool.
 */
export function extractToolDescription(
	tool: AISDKCoreTool,
): string | undefined {
	if ('description' in tool && typeof tool.description === 'string') {
		return tool.description;
	}
	return undefined;
}

/**
 * Extracts the input JSON Schema from an AI SDK tool, unwrapping the
 * `jsonSchema()` wrapper and falling back to the older `parameters` shape.
 */
export function extractToolSchema(
	tool: AISDKCoreTool,
): ToolInputSchema | undefined {
	// AI SDK v6 tools use inputSchema (from jsonSchema())
	if ('inputSchema' in tool && tool.inputSchema) {
		const schema = tool.inputSchema as {jsonSchema?: unknown};
		// jsonSchema() wraps the schema, so we need to unwrap it
		if (schema.jsonSchema) {
			return schema.jsonSchema as ToolInputSchema;
		}
		return schema as ToolInputSchema;
	}

	// Fallback: check for parameters (older format)
	if ('parameters' in tool && tool.parameters) {
		const params = tool.parameters as {jsonSchema?: unknown};
		if (params.jsonSchema) {
			return params.jsonSchema as ToolInputSchema;
		}
		return params as ToolInputSchema;
	}

	return undefined;
}

/**
 * Picks up to two example parameter names for a tool-call example — preferring
 * required params, falling back to whatever properties exist.
 */
export function selectExampleParamNames(
	properties: Record<string, unknown>,
	required: string[],
): string[] {
	return required.length > 0
		? required.slice(0, 2)
		: Object.keys(properties).slice(0, 2);
}
