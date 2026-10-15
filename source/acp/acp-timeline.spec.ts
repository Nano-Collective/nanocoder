import test from 'ava';
import {
	assistantToolCallIndex,
	beginTimelineCapture,
	extractTimelineTargets,
	finishTimelineCapture,
	isTimelineMutatingTool,
	resolveTruncationPoint,
} from '@/acp/acp-timeline';
import type {Message, ToolCall} from '@/types/core';
import type {TimelineEntryMeta} from '@/types/timeline';

const mockToolManager = (readOnly: string[] = []) =>
	({
		isReadOnly: (name: string) => readOnly.includes(name),
	}) as any;

test('isTimelineMutatingTool - skips read-only tools', t => {
	t.false(isTimelineMutatingTool(mockToolManager(['read_file']), 'read_file'));
});

test('isTimelineMutatingTool - skips task-list and ask_user tools', t => {
	const manager = mockToolManager();
	t.false(isTimelineMutatingTool(manager, 'write_tasks'));
	t.false(isTimelineMutatingTool(manager, 'ask_user'));
});

test('isTimelineMutatingTool - treats file and bash tools as mutating', t => {
	const manager = mockToolManager(['read_file']);
	t.true(isTimelineMutatingTool(manager, 'write_file'));
	t.true(isTimelineMutatingTool(manager, 'string_replace'));
	t.true(isTimelineMutatingTool(manager, 'execute_bash'));
	t.true(isTimelineMutatingTool(manager, 'agent'));
	t.true(isTimelineMutatingTool(manager, 'git_add'));
});

test('extractTimelineTargets - file tools return their path args', t => {
	t.deepEqual(extractTimelineTargets('write_file', {path: 'src/a.ts'}), [
		'src/a.ts',
	]);
	t.deepEqual(
		extractTimelineTargets('string_replace', {path: 'src/a.ts', old_str: 'x'}),
		['src/a.ts'],
	);
	t.deepEqual(extractTimelineTargets('diff_edit', {path: 'src/a.ts'}), [
		'src/a.ts',
	]);
});

test('extractTimelineTargets - file_op includes destination for move/copy', t => {
	t.deepEqual(
		extractTimelineTargets('file_op', {
			operation: 'move',
			path: 'a.ts',
			destination: 'b.ts',
		}),
		['a.ts', 'b.ts'],
	);
	t.deepEqual(
		extractTimelineTargets('file_op', {operation: 'delete', path: 'a.ts'}),
		['a.ts'],
	);
	t.deepEqual(
		extractTimelineTargets('file_op', {operation: 'mkdir', path: 'dir'}),
		[],
	);
});

test('extractTimelineTargets - opaque tools return the git-diff fallback', t => {
	t.is(extractTimelineTargets('execute_bash', {command: 'rm -rf src'}), 'opaque');
	t.is(extractTimelineTargets('agent', {prompt: 'edit files'}), 'opaque');
	t.is(extractTimelineTargets('git_commit', {message: 'wip'}), 'opaque');
});

test('assistantToolCallIndex - returns the last assistant message index', t => {
	const messages: Message[] = [
		{role: 'user', content: 'hi'},
		{role: 'assistant', content: '', tool_calls: []},
	];
	t.is(assistantToolCallIndex(messages), 1);
});

test('assistantToolCallIndex - falls back to messages.length when none', t => {
	const messages: Message[] = [{role: 'user', content: 'hi'}];
	t.is(assistantToolCallIndex(messages), 1);
});

// ============================================================================
// Truncation point
// ============================================================================

const metaFor = (overrides: Partial<TimelineEntryMeta> = {}) =>
	({
		id: 'cp',
		seq: 1,
		toolCallId: 'call-1',
		toolName: 'write_file',
		title: 'write_file',
		timestamp: '2026-01-01T00:00:00.000Z',
		truncateToMessageIndex: 1,
		filesChanged: [],
		...overrides,
	}) as TimelineEntryMeta;

test('resolveTruncationPoint - locates the turn that issued the tool call', t => {
	const messages: Message[] = [
		{role: 'user', content: 'first'},
		{role: 'assistant', content: '', tool_calls: [{id: 'call-1'} as ToolCall]},
		{role: 'tool', content: 'ok', tool_call_id: 'call-1', name: 'write_file'},
	];
	// A stale index must not win over the message that actually matches.
	t.is(
		resolveTruncationPoint(messages, metaFor({truncateToMessageIndex: 99})),
		1,
	);
});

test('resolveTruncationPoint - clamps an out-of-range stored index', t => {
	const messages: Message[] = [{role: 'user', content: 'only'}];
	t.is(
		resolveTruncationPoint(
			messages,
			metaFor({toolCallId: 'gone', truncateToMessageIndex: 42}),
		),
		1,
	);
});

// ============================================================================
// Opaque capture (bash, agent, MCP)
// ============================================================================

const toolCall = (name: string, args: Record<string, unknown>): ToolCall =>
	({
		id: 'call-1',
		type: 'function',
		function: {name, arguments: args},
	}) as ToolCall;

/**
 * Minimal stand-in for the parts of TimelineManager the capture helpers touch.
 * `scans` is consumed one entry per getModifiedFiles call: the first is the
 * before scan, the second the after scan.
 */
const mockSession = (options: {
	scans: Array<{
		files: string[];
		truncated?: boolean;
		available?: boolean;
	}>;
	head?: Record<string, {kind: 'text'; content: string} | {kind: 'binary'}>;
	onDisk?: Record<string, string>;
}) => {
	const scans = [...options.scans];
	const captured: Array<Map<string, string | null>> = [];
	return {
		captured,
		session: {
			timeline: {
				getModifiedFiles: () => {
					const next = scans.shift() ?? {files: []};
					return {
						files: next.files,
						truncated: next.truncated ?? false,
						available: next.available ?? true,
					};
				},
				toRelativePath: (value: string) =>
					value.startsWith('..') ? null : value,
				readHeadSnapshot: (value: string) =>
					options.head?.[value] ?? {kind: 'absent'},
				snapshotPaths: async (paths: string[]) => {
					const map = new Map<string, string | null>();
					for (const relative of paths) {
						map.set(relative, options.onDisk?.[relative] ?? null);
					}
					return map;
				},
				capture: async (input: {files: Map<string, string | null>}) => {
					captured.push(input.files);
					return metaFor();
				},
			},
		} as any,
	};
};

test('opaque capture - a truncated before scan records no checkpoint', async t => {
	const {session, captured} = mockSession({
		scans: [{files: ['a.ts'], truncated: true}],
	});

	const context = await beginTimelineCapture(
		session,
		mockToolManager(),
		toolCall('execute_bash', {command: 'sed -i s/a/b/ *.ts'}),
		[{role: 'assistant', content: ''}],
		'execute_bash',
	);

	// A truncated scan makes dirty files look clean, so their before-images
	// would be taken from HEAD and revert would discard uncommitted work.
	t.is(context, null);
	t.is(captured.length, 0);
});

test('opaque capture - no checkpoint when git cannot answer', async t => {
	const {session} = mockSession({scans: [{files: [], available: false}]});

	t.is(
		await beginTimelineCapture(
			session,
			mockToolManager(),
			toolCall('execute_bash', {command: 'ls'}),
			[{role: 'assistant', content: ''}],
			'execute_bash',
		),
		null,
	);
});

test('opaque capture - newly dirty files take their before-image from HEAD', async t => {
	const {session, captured} = mockSession({
		scans: [{files: ['dirty.ts']}, {files: ['dirty.ts', 'clean.ts']}],
		onDisk: {'dirty.ts': 'working copy'},
		head: {'clean.ts': {kind: 'text', content: 'committed'}},
	});

	const context = await beginTimelineCapture(
		session,
		mockToolManager(),
		toolCall('execute_bash', {command: 'edit'}),
		[{role: 'assistant', content: ''}],
		'execute_bash',
	);
	await finishTimelineCapture(session, context);

	t.is(captured.length, 1);
	// The already-dirty file keeps its on-disk before-image, not HEAD.
	t.is(captured[0].get('dirty.ts'), 'working copy');
	t.is(captured[0].get('clean.ts'), 'committed');
});

test('opaque capture - a file absent from HEAD is recorded as created', async t => {
	const {session, captured} = mockSession({
		scans: [{files: []}, {files: ['brand-new.ts']}],
	});

	const context = await beginTimelineCapture(
		session,
		mockToolManager(),
		toolCall('execute_bash', {command: 'touch brand-new.ts'}),
		[{role: 'assistant', content: ''}],
		'execute_bash',
	);
	await finishTimelineCapture(session, context);

	t.is(captured[0].get('brand-new.ts'), null);
});

test('opaque capture - a tracked binary is skipped, not marked created', async t => {
	const {session, captured} = mockSession({
		scans: [{files: []}, {files: ['logo.png']}],
		head: {'logo.png': {kind: 'binary'}},
	});

	const context = await beginTimelineCapture(
		session,
		mockToolManager(),
		toolCall('execute_bash', {command: 'optipng logo.png'}),
		[{role: 'assistant', content: ''}],
		'execute_bash',
	);
	await finishTimelineCapture(session, context);

	// Recording it as created would make revert delete a file that only
	// changed, and a UTF-8 snapshot of it would be corrupt either way.
	t.false(captured[0]?.has('logo.png') ?? false);
});

test('opaque capture - a truncated after scan abandons the checkpoint', async t => {
	const {session, captured} = mockSession({
		scans: [{files: []}, {files: ['a.ts'], truncated: true}],
	});

	const context = await beginTimelineCapture(
		session,
		mockToolManager(),
		toolCall('execute_bash', {command: 'edit'}),
		[{role: 'assistant', content: ''}],
		'execute_bash',
	);
	t.is(await finishTimelineCapture(session, context), null);
	t.is(captured.length, 0);
});
