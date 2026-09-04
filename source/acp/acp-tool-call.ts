import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {
	ToolCallContent,
	ToolCallLocation,
	ToolKind,
} from '@agentclientprotocol/sdk';
import type {ToolCall} from '@/types/core';
import {replaceFirstLiteral} from '@/utils/literal-replace';

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
	diff_edit: 'edit',
	execute_bash: 'execute',
	fetch_url: 'fetch',
	web_search: 'fetch',
	agent: 'think',
	switch_mode: 'switch_mode',
};

export interface BuildToolCallMetaOptions {
	/**
	 * Build the before/after diff for edit tools. Diffing reads the whole file
	 * off disk, so callers that discard content - the queued-batch announcement
	 * - opt out instead of paying for a diff they never emit.
	 */
	withDiff?: boolean;
}

/**
 * Enrich a tool call with ACP metadata: a descriptive title, a kind, the file
 * locations it touches (for "follow-along"), and - for edits - a diff so the
 * client (e.g. Zed) can render a proper before/after view in the tool card and
 * permission prompt.
 */
export async function buildToolCallMeta(
	toolCall: ToolCall,
	options: BuildToolCallMetaOptions = {},
): Promise<AcpToolCallMeta> {
	const {withDiff = true} = options;
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
		case 'file_op':
			return buildFileOpMeta(args);
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
		if (withDiff) {
			if (name === 'string_replace') {
				const diff = await buildStringReplaceDiff(path, args);
				if (diff) content.push(diff);
			} else if (name === 'write_file') {
				content.push(await buildWriteFileDiff(path, args));
			}
		}
	}

	return {title, kind, locations, content};
}

/**
 * file_op is four tools behind one name, and the operation - not the name - is
 * what tells a client whether a path is appearing, moving or going away.
 *
 * `locations` keeps the rule the rest of this file follows: the file the call
 * leaves behind comes last. A move therefore reports [source, destination], so
 * a client can follow the file to its new path instead of holding a reference
 * to one that no longer exists.
 */
function buildFileOpMeta(args: Record<string, unknown>): AcpToolCallMeta {
	const operation = asString(args.operation);
	const path = extractPath(args);
	const destination = asString(args.destination);

	// mkdir stays 'other': it creates a directory, which is nothing to open.
	const kind: ToolKind =
		operation === 'delete'
			? 'delete'
			: operation === 'move'
				? 'move'
				: operation === 'copy'
					? 'edit'
					: 'other';

	const locations: ToolCallLocation[] = [];
	// A copy leaves its source untouched, so only the new file is reported, and
	// mkdir reports nothing at all: clients treat `locations` as things to open,
	// and the directory it creates is not one of them.
	if (path && operation !== 'copy' && operation !== 'mkdir') {
		locations.push({path: resolve(path)});
	}
	if (destination && (operation === 'move' || operation === 'copy')) {
		locations.push({path: resolve(destination)});
	}

	const target = [path, destination].filter(Boolean).join(' → ');
	const title = target
		? `file_op: ${operation ?? 'run'} ${target}`
		: `file_op: ${operation ?? 'run'}`;

	return {title, kind, locations, content: []};
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
		newText: replaceFirstLiteral(current, oldStr, newStr),
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
