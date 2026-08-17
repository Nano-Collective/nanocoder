import test from 'ava';
import {
	assistantToolCallIndex,
	extractTimelineTargets,
	isTimelineMutatingTool,
} from '@/acp/acp-timeline';
import type {Message} from '@/types/core';

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
	t.false(isTimelineMutatingTool(manager, 'create_task'));
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
