import type {JSONSchema7} from 'ai';
import {makeCustomToolFormatter} from '@/custom-tools/formatter';
import {buildHandler} from '@/custom-tools/handler';
import {buildJsonSchema, buildValidator} from '@/custom-tools/schema-builder';
import {jsonSchema, tool} from '@/types/core';
import type {
	CustomToolApprovalPolicy,
	LoadedCustomTool,
} from '@/types/custom-tools';
import type {ToolEntry} from '@/types/index';
import {createFileToolApproval} from '@/utils/tool-approval';

/**
 * Compose a registry-ready `ToolEntry` from a loaded custom tool.
 *
 * Mirrors how built-in tools are constructed: a `tool()` carrying the JSON
 * schema and a needsApproval policy, plus a synthesized handler, validator,
 * and formatter.
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
		needsApproval: approvalForPolicy(metadata.name, metadata.approval),
		execute: async (args, _options) => {
			return handler(args as Record<string, unknown>);
		},
	});

	return {
		name: metadata.name,
		tool: aiSdkTool,
		handler,
		validator,
		formatter,
		readOnly: metadata.readOnly,
	};
}

function approvalForPolicy(
	name: string,
	policy: CustomToolApprovalPolicy,
): boolean | (() => boolean) {
	switch (policy) {
		case 'never':
			return false;
		case 'always':
			return true;
		case 'destructive':
			return createFileToolApproval(name);
	}
}
