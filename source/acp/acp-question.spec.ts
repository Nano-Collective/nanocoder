import test from 'ava';
import {requestUserChoice} from '@/acp/acp-question';

console.log('\nacp-question.spec.ts');

const OPTIONS = ['Option A', 'Option B', 'Option C'];

test('requestUserChoice - returns the selected option text', async t => {
	const conn = {
		requestPermission: async () => ({
			outcome: {outcome: 'selected', optionId: 'answer-1'},
		}),
	} as any;
	const answer = await requestUserChoice(
		conn,
		'sess-1',
		'call-1',
		'Which approach?',
		OPTIONS,
	);
	t.is(answer, 'Option B');
});

test('requestUserChoice - reuses the tool call id as the permission target', async t => {
	let received: any;
	const conn = {
		requestPermission: async (params: any) => {
			received = params;
			return {outcome: {outcome: 'selected', optionId: 'answer-0'}};
		},
	} as any;
	await requestUserChoice(conn, 'sess-1', 'call-42', 'Pick', OPTIONS);
	t.is(received.sessionId, 'sess-1');
	t.is(received.toolCall.toolCallId, 'call-42');
	t.is(received.toolCall.title, 'Pick');
	t.is(received.options.length, 3);
	t.is(received.options[2].name, 'Option C');
});

test('requestUserChoice - returns an error string when dismissed', async t => {
	const conn = {
		requestPermission: async () => ({outcome: {outcome: 'cancelled'}}),
	} as any;
	const answer = await requestUserChoice(conn, 's', 'c', 'Q', OPTIONS);
	t.true(answer.startsWith('Error:'));
});

test('requestUserChoice - returns an error string on out-of-range option', async t => {
	const conn = {
		requestPermission: async () => ({
			outcome: {outcome: 'selected', optionId: 'answer-99'},
		}),
	} as any;
	const answer = await requestUserChoice(conn, 's', 'c', 'Q', OPTIONS);
	t.true(answer.startsWith('Error:'));
});

test('requestUserChoice - returns an error string when the client throws', async t => {
	const conn = {
		requestPermission: async () => {
			throw new Error('connection closed');
		},
	} as any;
	const answer = await requestUserChoice(conn, 's', 'c', 'Q', OPTIONS);
	t.true(answer.startsWith('Error:'));
	t.true(answer.includes('connection closed'));
});
