import test from 'ava';
import type {Message} from '@/types/core';
import {capMessagesForModel} from './message-capping.js';
import {
	clearReadTracker,
	isReadStub,
	matchReadContent,
	rememberReadContent,
} from './read-tracker.js';

test('capMessagesForModel does not slice if history is within limit', t => {
	const messages: Message[] = [
		{role: 'user', content: 'hello'},
		{role: 'assistant', content: 'hi'},
	];
	const capped = capMessagesForModel(messages, 5);
	t.deepEqual(capped, messages);
});

test('capMessagesForModel slices normally when no tool calls are near the boundary', t => {
	const messages: Message[] = [
		{role: 'user', content: 'msg 1'},
		{role: 'assistant', content: 'msg 2'},
		{role: 'user', content: 'msg 3'},
		{role: 'assistant', content: 'msg 4'},
	];
	const capped = capMessagesForModel(messages, 2);
	t.deepEqual(capped, [
		{role: 'user', content: 'msg 3'},
		{role: 'assistant', content: 'msg 4'},
	]);
});

test('capMessagesForModel walks back to avoid orphaned tool results', t => {
	const messages: Message[] = [
		{role: 'user', content: 'run command'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [{id: 'call_1', function: {name: 'bash', arguments: {}}}],
		},
		{role: 'tool', tool_call_id: 'call_1', name: 'bash', content: 'output'},
		{role: 'user', content: 'another command'},
	];

	// Cap at 2 messages. Naively, this would start at index 2: { role: 'tool' ... }.
	// That would start with an orphaned tool result.
	// Our helper must walk back to index 1 to include the assistant message.
	const capped = capMessagesForModel(messages, 2);

	t.deepEqual(capped, [
		{
			role: 'assistant',
			content: '',
			tool_calls: [{id: 'call_1', function: {name: 'bash', arguments: {}}}],
		},
		{role: 'tool', tool_call_id: 'call_1', name: 'bash', content: 'output'},
		{role: 'user', content: 'another command'},
	]);
});

test('capMessagesForModel walks back through multiple tool results', t => {
	const messages: Message[] = [
		{role: 'user', content: 'run parallel tools'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{id: 'call_1', function: {name: 'bash', arguments: {}}},
				{id: 'call_2', function: {name: 'read', arguments: {}}},
			],
		},
		{role: 'tool', tool_call_id: 'call_1', name: 'bash', content: 'out 1'},
		{role: 'tool', tool_call_id: 'call_2', name: 'read', content: 'out 2'},
		{role: 'user', content: 'thanks'},
	];

	// Cap at 2 messages (start at index 3: { role: 'tool', tool_call_id: 'call_2' }).
	// Must walk back to index 1 (the assistant message).
	const capped = capMessagesForModel(messages, 2);

	t.deepEqual(capped, [
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{id: 'call_1', function: {name: 'bash', arguments: {}}},
				{id: 'call_2', function: {name: 'read', arguments: {}}},
			],
		},
		{role: 'tool', tool_call_id: 'call_1', name: 'bash', content: 'out 1'},
		{role: 'tool', tool_call_id: 'call_2', name: 'read', content: 'out 2'},
		{role: 'user', content: 'thanks'},
	]);
});

const STATS = {mtimeMs: 1, size: 10};
const FILE = '/tmp/cap-spec/app.ts';

function readTurn(
	id: string,
	content: string,
	args: Record<string, unknown> = {path: FILE},
): Message[] {
	return [
		{
			role: 'assistant',
			content: '',
			tool_calls: [{id, function: {name: 'read_file', arguments: args}}],
		},
		{role: 'tool', tool_call_id: id, name: 'read_file', content},
	];
}

const filler = (n: number): Message[] =>
	Array.from({length: n}, (_, i) => ({
		role: i % 2 ? ('assistant' as const) : ('user' as const),
		content: `filler ${i}`,
	}));

test.serial('dropping a read_file body forgets its stub entry', t => {
	clearReadTracker();
	rememberReadContent(FILE, STATS, 3);
	const messages = [...readTurn('r1', 'line 1\nline 2\nline 3'), ...filler(4)];
	capMessagesForModel(messages, 4);
	t.is(matchReadContent(FILE, STATS), undefined);
});

test.serial('a body still in the kept window keeps its stub entry', t => {
	clearReadTracker();
	rememberReadContent(FILE, STATS, 3);
	const messages = [
		...readTurn('r1', 'old body'),
		...filler(2),
		...readTurn('r2', 'fresh body'),
	];
	capMessagesForModel(messages, 3);
	t.deepEqual(matchReadContent(FILE, STATS), {lineCount: 3, size: 10});
});

test.serial('a kept stub does not stand in for a dropped body', t => {
	clearReadTracker();
	rememberReadContent(FILE, STATS, 3);
	const stub = `[file: ${FILE} — already in context, unchanged since last read (3 lines, 10 bytes). pass start_line/end_line to read the body again.]`;
	t.true(isReadStub(stub));
	const messages = [
		...readTurn('r1', 'the body'),
		...filler(2),
		...readTurn('r2', stub),
	];
	capMessagesForModel(messages, 3);
	t.is(matchReadContent(FILE, STATS), undefined);
});

test.serial('only the dropped range is forgotten', t => {
	clearReadTracker();
	rememberReadContent(FILE, STATS, 10, 1, 10);
	rememberReadContent(FILE, STATS, 3);
	const messages = [
		...readTurn('r1', 'lines 1-10', {path: FILE, start_line: 1, end_line: 10}),
		...filler(2),
		...readTurn('r2', 'whole file'),
	];
	capMessagesForModel(messages, 3);
	t.is(matchReadContent(FILE, STATS, 1, 10), undefined);
	t.truthy(matchReadContent(FILE, STATS));
});

test.serial('a body that merely contains the stub marker text is still a body', t => {
	t.false(
		isReadStub(
			"export const READ_STUB_MARKER = 'already in context, unchanged since last read';\n",
		),
	);
});

test.serial('capping within the limit leaves stub entries alone', t => {
	clearReadTracker();
	rememberReadContent(FILE, STATS, 3);
	capMessagesForModel(readTurn('r1', 'body'), 10);
	t.truthy(matchReadContent(FILE, STATS));
});
