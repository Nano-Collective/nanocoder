import type {JSONSchema7} from 'ai';
import {makeCustomToolFormatter} from '@/custom-tools/formatter';
import {buildHandler} from '@/custom-tools/handler';
import {buildJsonSchema, buildValidator} from '@/custom-tools/schema-builder';
import {jsonSchema, tool} from '@/types/core';
import type {
	CustomToolApprovalPolicy,
	LoadedCustomTool,
} from '@/types/custom-tools';
import type {ToolApprovalPolicy, ToolEntry} from '@/types/index';
import {createFileToolApproval} from '@/utils/tool-approval';
import {withValidation} from '@/utils/tool-validation';

/**
 * Compose a registry-ready `ToolEntry` from a loaded custom tool.
 *
 * Mirrors how built-in tools are constructed: a `tool()` carrying the JSON
 * schema, plus a synthesized handler, validator, formatter, and a mode-aware
 * `approval` policy resolved from the tool's declared approval mode.
 */
export function buildToolEntry(
	loaded: LoadedCustomTool,
	projectRoot: string,
): ToolEntry {
	const {metadata, body} = loaded;
	const handler = buildHandler(metadata, body, projectRoot);
	const validator = buildValidator(metadata);
	const formatter = makeCustomToolFormatter(metadata.name);
	const aiSdkTool = tool({
		description: metadata.description,
		inputSchema: jsonSchema(buildJsonSchema(metadata) as JSONSchema7),
		execute: async (args, _options) => {
			return handler(args as Record<string, unknown>);
		},
	});

	return {
		name: metadata.name,
		tool: aiSdkTool,
		// Validate inside the handler so every execution path is covered.
		handler: withValidation(handler, validator),
		validator,
		formatter,
		readOnly: metadata.readOnly,
		approval: approvalForPolicy(metadata.name, metadata.approval),
	};
}

function approvalForPolicy(
	name: string,
	policy: CustomToolApprovalPolicy,
): ToolApprovalPolicy {
	switch (policy) {
		case 'never':
			return false;
		case 'always':
			return true;
		case 'destructive':
			return createFileToolApproval(name);
	}
}
