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

/**
 * Tools that are not read-only but touch no workspace file, so there is
 * nothing for a checkpoint to restore.
 */
const NON_WORKSPACE_TOOLS = new Set(['ask_user', 'write_tasks']);

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

/**
 * Where to cut history so a reverted turn leaves no trace.
 *
 * The stored index is an absolute position captured when the turn ran. It is
 * correct today because nothing rewrites `session.messages`, but locating the
 * assistant message that issued the tool call is self-correcting if anything
 * ever does (compaction, trimming). The stored index is the fallback, clamped
 * so an out-of-range value cannot silently leave the whole turn in history.
 */
export function resolveTruncationPoint(
	messages: Message[],
	entry: TimelineEntryMeta,
): number {
	const byToolCall = messages.findIndex(
		message =>
			message.role === 'assistant' &&
			message.tool_calls?.some(call => call.id === entry.toolCallId),
	);
	if (byToolCall !== -1) {
		return byToolCall;
	}
	return Math.min(entry.truncateToMessageIndex, messages.length);
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
			const scan = session.timeline.getModifiedFiles();
			// A truncated scan makes a dirty file look clean, and
			// finishTimelineCapture would then take its before-image from HEAD
			// and throw away the user's uncommitted work on revert. No
			// checkpoint is safer than a wrong one.
			if (scan.truncated) {
				logWarning(
					'Skipping action timeline checkpoint: too many modified files',
					true,
					{context: {toolName, fileCount: scan.files.length}},
				);
				return null;
			}
			if (!scan.available) {
				return null;
			}
			const files = await session.timeline.snapshotPaths(scan.files);
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
		const after = session.timeline.getModifiedFiles();
		if (after.truncated || !after.available) {
			return null;
		}
		for (const filePath of after.files) {
			const relative = session.timeline.toRelativePath(filePath);
			if (!relative || context.beforeKeys.has(relative)) {
				continue;
			}
			// Clean before the call, dirty after it, so HEAD is the before-image.
			const head = session.timeline.readHeadSnapshot(relative);
			if (head.kind === 'binary') {
				// Recording it as created would make revert delete a tracked
				// file the tool only edited.
				continue;
			}
			context.files.set(relative, head.kind === 'text' ? head.content : null);
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
