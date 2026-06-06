import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {
	ToolCallContent,
	ToolCallLocation,
	ToolKind,
} from '@agentclientprotocol/sdk';
import type {ToolCall} from '@/types/core';

export interface AcpToolCallMeta {
	title: string;
	kind: ToolKind;
	locations: ToolCallLocation[];
	content: ToolCallContent[];
}

/**
 * Maps nanocoder tool names to ACP tool kinds so clients can render the right
 * icon/affordance. Unknown tools (custom, MCP) fall back to `other`.
 */
const TOOL_KINDS: Record<string, ToolKind> = {
	read_file: 'read',
	list_directory: 'read',
	lsp_get_diagnostics: 'read',
	search_file_contents: 'search',
	find_files: 'search',
	string_replace: 'edit',
	write_file: 'edit',
	execute_bash: 'execute',
	fetch_url: 'fetch',
	web_search: 'fetch',
	agent: 'think',
	switch_mode: 'switch_mode',
};

/**
 * Enrich a tool call with ACP metadata: a descriptive title, a kind, the file
 * locations it touches (for "follow-along"), and - for edits - a diff so the
 * client (e.g. Zed) can render a proper before/after view in the tool card and
 * permission prompt.
 */
export async function buildToolCallMeta(
	toolCall: ToolCall,
): Promise<AcpToolCallMeta> {
	const name = toolCall.function.name;
	const args = toolCall.function.arguments ?? {};
	const kind = TOOL_KINDS[name] ?? 'other';

	// Tools that read better with a custom title/body than a generic name.
	switch (name) {
		case 'ask_user':
			return {
				title: asString(args.question) ?? 'ask_user',
				kind,
				locations: [],
				content: [],
			};
		case 'agent':
			return buildAgentMeta(args, kind);
		case 'execute_bash': {
			const command = asString(args.command);
			return {
				title: command
					? `execute_bash: ${truncate(command, 80)}`
					: 'execute_bash',
				kind,
				locations: [],
				content: [],
			};
		}
		default:
			break;
	}

	const path = extractPath(args);
	const locations: ToolCallLocation[] = path ? [{path: resolve(path)}] : [];
	const content: ToolCallContent[] = [];
	let title = name;

	if (path) {
		title = `${name}: ${path}`;
		if (name === 'string_replace') {
			const diff = await buildStringReplaceDiff(path, args);
			if (diff) content.push(diff);
		} else if (name === 'write_file') {
			content.push(await buildWriteFileDiff(path, args));
		}
	}

	return {title, kind, locations, content};
}

function buildAgentMeta(
	args: Record<string, unknown>,
	kind: ToolKind,
): AcpToolCallMeta {
	const subagent = asString(args.subagent_type) ?? 'subagent';
	const description = asString(args.description);
	const prompt = asString(args.prompt);

	const title = description
		? `${subagent}: ${description}`
		: `Delegate to ${subagent}`;

	const content: ToolCallContent[] = [];
	if (prompt) {
		content.push({type: 'content', content: {type: 'text', text: prompt}});
	}

	return {title, kind, locations: [], content};
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function truncate(text: string, max: number): string {
	const firstLine = text.split('\n', 1)[0];
	return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}

function extractPath(args: Record<string, unknown>): string | undefined {
	if (typeof args.path === 'string') return args.path;
	if (typeof args.file_path === 'string') return args.file_path;
	return undefined;
}

async function buildStringReplaceDiff(
	path: string,
	args: Record<string, unknown>,
): Promise<ToolCallContent | undefined> {
	const oldStr = typeof args.old_str === 'string' ? args.old_str : undefined;
	const newStr = typeof args.new_str === 'string' ? args.new_str : undefined;
	if (oldStr === undefined || newStr === undefined) {
		return undefined;
	}

	const absPath = resolve(path);
	let current: string;
	try {
		current = await readFile(absPath, 'utf8');
	} catch {
		// File unreadable (new path, permissions): show the hunk on its own.
		return {type: 'diff', path: absPath, oldText: oldStr, newText: newStr};
	}

	// Only synthesize a whole-file diff when the replacement is unambiguous,
	// mirroring the tool's own uniqueness requirement. Otherwise fall back to
	// the hunk so the user still sees what is changing.
	const occurrences = current.split(oldStr).length - 1;
	if (occurrences !== 1) {
		return {type: 'diff', path: absPath, oldText: oldStr, newText: newStr};
	}

	return {
		type: 'diff',
		path: absPath,
		oldText: current,
		newText: current.replace(oldStr, newStr),
	};
}

async function buildWriteFileDiff(
	path: string,
	args: Record<string, unknown>,
): Promise<ToolCallContent> {
	const newText =
		typeof args.content === 'string'
			? args.content
			: String(args.content ?? '');
	const absPath = resolve(path);

	let oldText: string | null = null;
	try {
		oldText = await readFile(absPath, 'utf8');
	} catch {
		oldText = null; // New file.
	}

	return {type: 'diff', path: absPath, oldText, newText};
}
