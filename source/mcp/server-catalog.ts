import type {Client} from '@modelcontextprotocol/sdk/client/index.js';
import type {
	MCPPrompt,
	MCPPromptResult,
	MCPResource,
	MCPResourceContent,
	MCPTool,
	MCPToolInputSchema,
} from '@/types/index';
import {isPlainObject} from '@/utils/type-helpers';

/**
 * Pure mapping between what an MCP server reports (tools/list,
 * resources/list, prompts/list, resources/read, prompts/get) and nanocoder's
 * own MCP types, plus the lookups derived from the per-server tool lists.
 */

type SDKTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];
type SDKResource = Awaited<
	ReturnType<Client['listResources']>
>['resources'][number];
type SDKPrompt = Awaited<ReturnType<Client['listPrompts']>>['prompts'][number];
type SDKResourceContents = Awaited<
	ReturnType<Client['readResource']>
>['contents'];
type SDKPromptResult = Awaited<ReturnType<Client['getPrompt']>>;

export type MCPToolMapping = Map<
	string,
	{serverName: string; originalName: string; readOnly: boolean}
>;

export interface MCPToolNameConflict {
	tool: string;
	servers: string[];
	active: string;
}

export function toMCPTool(tool: SDKTool, serverName: string): MCPTool {
	return {
		name: tool.name,
		description: tool.description || undefined,
		// MCP SDK types inputSchema as Record<string, object>; validate at protocol boundary
		// before trusting the shape as JSONSchema7
		inputSchema: isPlainObject(tool.inputSchema)
			? (tool.inputSchema as MCPToolInputSchema)
			: undefined,
		serverName,
		readOnly: tool.annotations?.readOnlyHint === true,
	};
}

export function toMCPResource(
	resource: SDKResource,
	serverName: string,
): MCPResource {
	return {
		uri: resource.uri,
		name: resource.name,
		description: resource.description || undefined,
		mimeType: resource.mimeType || undefined,
		serverName,
	};
}

export function toMCPPrompt(prompt: SDKPrompt, serverName: string): MCPPrompt {
	return {
		name: prompt.name,
		description: prompt.description || undefined,
		arguments: prompt.arguments?.map(arg => ({
			name: arg.name,
			description: arg.description || undefined,
			required: arg.required || false,
		})),
		serverName,
	};
}

/**
 * Text vs. blob content is NOT distinguished by a `type` field in the MCP
 * schema — TextResourceContents carries a `text` property,
 * BlobResourceContents carries a `blob` property, and neither declares the
 * other. Discriminate on which key is present.
 */
export function toResourceContents(
	contents: SDKResourceContents | undefined,
): MCPResourceContent[] {
	return (contents ?? []).map(c => {
		const block = c as {
			uri: string;
			mimeType?: string;
			text?: string;
			blob?: string;
		};
		return {
			uri: block.uri,
			mimeType: block.mimeType,
			text: 'text' in block ? block.text : undefined,
			blob: 'blob' in block ? block.blob : undefined,
		};
	});
}

export function toPromptResult(result: SDKPromptResult): MCPPromptResult {
	return {
		description: result.description,
		messages: result.messages.map(
			(msg: {
				role: string;
				content:
					| {
							type: string;
							text?: string;
							data?: string;
							mimeType?: string;
					  }
					| string;
			}) => ({
				role: msg.role as 'user' | 'assistant',
				content:
					typeof msg.content === 'string'
						? {type: 'text' as const, text: msg.content}
						: {
								type: msg.content.type as 'text' | 'image' | 'resource',
								text: msg.content.text,
								data: msg.content.data,
								mimeType: msg.content.mimeType,
							},
			}),
		),
	};
}

/**
 * Tool names exposed by more than one connected server. Tools are keyed by
 * name, so only one of them is callable: the server connected last (later
 * in `serverTools` order) handles every call to that name.
 */
export function findToolNameConflicts(
	serverTools: Map<string, MCPTool[]>,
): MCPToolNameConflict[] {
	const owners = new Map<string, string[]>();
	for (const [serverName, tools] of serverTools.entries()) {
		for (const mcpTool of tools) {
			const list = owners.get(mcpTool.name) ?? [];
			list.push(serverName);
			owners.set(mcpTool.name, list);
		}
	}
	const conflicts: MCPToolNameConflict[] = [];
	for (const [tool, servers] of owners) {
		if (servers.length < 2) continue;
		conflicts.push({tool, servers, active: servers[servers.length - 1]});
	}
	return conflicts;
}

/**
 * Map every discovered tool name to the server that owns it, plus the
 * server's raw `readOnlyHint` for that tool. A later server overwrites an
 * earlier one that exposes the same name.
 */
export function buildToolMapping(
	serverTools: Map<string, MCPTool[]>,
): MCPToolMapping {
	const mapping: MCPToolMapping = new Map();
	for (const [serverName, tools] of serverTools.entries()) {
		for (const mcpTool of tools) {
			mapping.set(mcpTool.name, {
				serverName,
				originalName: mcpTool.name,
				readOnly: mcpTool.readOnly === true,
			});
		}
	}
	return mapping;
}
