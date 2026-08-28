import type {ToolManager} from '@/tools/tool-manager';
import type {Message, ToolCall} from '@/types/core';
import type {TimelineEntryMeta} from '@/types/timeline';
import {formatError} from '@/utils/error-formatter';
import {logWarning} from '@/utils/message-queue';
import type {AcpSession} from './acp-session';

const FILE_ARG_TOOLS = new Set([
	'write_file',
	'string_replace',
	'diff_edit',
	'file_op',
]);

const NON_WORKSPACE_TOOLS = new Set([
	'ask_user',
	'write_tasks',
	'create_task',
	'update_task',
	'delete_task',
	'list_tasks',
	'switch_mode',
]);

export function isTimelineMutatingTool(
	toolManager: ToolManager,
	toolName: string,
): boolean {
	if (NON_WORKSPACE_TOOLS.has(toolName)) {
		return false;
	}
	return !toolManager.isReadOnly(toolName);
}

/**
 * Exact file paths this tool will touch, or `'opaque'` when we must fall
 * back to a git-status diff (bash, agent, git mutators, custom/MCP).
 * An empty array means skip capture (e.g. `file_op mkdir`).
 */
export function extractTimelineTargets(
	toolName: string,
	args: Record<string, unknown>,
): string[] | 'opaque' {
	if (!FILE_ARG_TOOLS.has(toolName)) {
		return 'opaque';
	}

	const paths: string[] = [];
	if (typeof args.path === 'string' && args.path.length > 0) {
		paths.push(args.path);
	}
	if (typeof args.file_path === 'string' && args.file_path.length > 0) {
		paths.push(args.file_path);
	}

	if (toolName === 'file_op') {
		const operation = args.operation;
		if (operation === 'mkdir') {
			return [];
		}
		if (
			(operation === 'move' || operation === 'copy') &&
			typeof args.destination === 'string' &&
			args.destination.length > 0
		) {
			paths.push(args.destination);
		}
	}

	return paths;
}

export function assistantToolCallIndex(messages: Message[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant') {
			return i;
		}
	}
	return messages.length;
}

interface OpaqueCaptureContext {
	mode: 'opaque';
	beforeKeys: Set<string>;
	files: Map<string, string | null>;
	toolCallId: string;
	toolName: string;
	title: string;
	truncateToMessageIndex: number;
}

interface DirectCaptureContext {
	mode: 'direct';
	entry: TimelineEntryMeta | null;
}

export type TimelineCaptureContext =
	| OpaqueCaptureContext
	| DirectCaptureContext
	| null;

export async function beginTimelineCapture(
	session: AcpSession,
	toolManager: ToolManager,
	toolCall: ToolCall,
	messages: Message[],
	title: string,
): Promise<TimelineCaptureContext> {
	const toolName = toolCall.function.name;
	if (!isTimelineMutatingTool(toolManager, toolName)) {
		return null;
	}

	const args = (toolCall.function.arguments ?? {}) as Record<string, unknown>;
	const targets = extractTimelineTargets(toolName, args);
	if (targets !== 'opaque' && targets.length === 0) {
		return null;
	}

	const truncateToMessageIndex = assistantToolCallIndex(messages);
	const meta = {
		toolCallId: toolCall.id,
		toolName,
		title,
		truncateToMessageIndex,
	};

	try {
		if (targets === 'opaque') {
			const modified = session.timeline.getModifiedFiles();
			const files = await session.timeline.snapshotPaths(modified);
			return {
				mode: 'opaque',
				beforeKeys: new Set(files.keys()),
				files,
				...meta,
			};
		}

		const files = await session.timeline.snapshotPaths(targets);
		const entry = await session.timeline.capture({...meta, files});
		return {mode: 'direct', entry};
	} catch (error) {
		logWarning('Failed to capture action timeline checkpoint', true, {
			context: {toolName, error: formatError(error)},
		});
		return null;
	}
}

export async function finishTimelineCapture(
	session: AcpSession,
	context: TimelineCaptureContext,
): Promise<TimelineEntryMeta | null> {
	if (!context || context.mode !== 'opaque') {
		return context?.mode === 'direct' ? context.entry : null;
	}

	try {
		const afterModified = session.timeline.getModifiedFiles();
		for (const filePath of afterModified) {
			const relative = session.timeline.toRelativePath(filePath);
			if (!relative || context.beforeKeys.has(relative)) {
				continue;
			}
			const head = session.timeline.getHeadContent(relative);
			context.files.set(relative, head);
		}

		return await session.timeline.capture({
			toolCallId: context.toolCallId,
			toolName: context.toolName,
			title: context.title,
			truncateToMessageIndex: context.truncateToMessageIndex,
			files: context.files,
		});
	} catch (error) {
		logWarning('Failed to finalize action timeline checkpoint', true, {
			context: {toolName: context.toolName, error: formatError(error)},
		});
		return null;
	}
}
