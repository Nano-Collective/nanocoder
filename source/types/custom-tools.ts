/**
 * Types for file-based custom tools loaded from `.nanocoder/tools/`.
 *
 * A custom tool is a markdown file with YAML frontmatter (metadata + parameter
 * schema) and a shell-script body. The loader synthesizes a full
 * `NanocoderToolExport` from the metadata so custom tools sit alongside
 * built-ins and MCP tools in the unified registry.
 */

export type CustomToolParameterType =
	| 'string'
	| 'number'
	| 'integer'
	| 'boolean'
	| 'array';

export type CustomToolApprovalPolicy = 'never' | 'always' | 'destructive';

export type CustomToolShell = 'bash' | 'sh';

/**
 * A single entry under `parameters:` in the frontmatter. Mirrors the subset
 * of JSON Schema we surface to the LLM and validate locally.
 */
export interface CustomToolParameterDef {
	type: CustomToolParameterType;
	description?: string;
	required?: boolean;
	default?: unknown;
	enum?: unknown[];
	pattern?: string;
	minLength?: number;
	maxLength?: number;
	min?: number;
	max?: number;
	items?: {type: CustomToolParameterType};
}

/**
 * Parsed frontmatter of a custom tool markdown file.
 */
export interface CustomToolMetadata {
	name: string;
	description: string;
	parameters: Record<string, CustomToolParameterDef>;
	approval: CustomToolApprovalPolicy;
	readOnly: boolean;
	timeoutMs: number;
	cwd?: string;
	env?: Record<string, string>;
	shell?: CustomToolShell;
}

/**
 * Loaded custom tool: parsed metadata, raw script body, and provenance info.
 */
export interface LoadedCustomTool {
	metadata: CustomToolMetadata;
	body: string;
	filePath: string;
	source: 'personal' | 'project';
}
