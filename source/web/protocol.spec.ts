import test from 'ava';
import {parseWebClientEvent, WEB_PROTOCOL_VERSION} from './protocol.js';

test('parseWebClientEvent accepts approval and question responses', t => {
	t.deepEqual(
		parseWebClientEvent(
			JSON.stringify({
				type: 'approval_response',
				id: 'approval-1',
				approved: true,
			}),
		),
		{type: 'approval_response', id: 'approval-1', approved: true},
	);

	t.deepEqual(
		parseWebClientEvent(
			JSON.stringify({
				type: 'question_response',
				id: 'question-1',
				answer: 'Use the existing bridge',
			}),
		),
		{
			type: 'question_response',
			id: 'question-1',
			answer: 'Use the existing bridge',
		},
	);
});

test('parseWebClientEvent still accepts the phase 4 handshake events', t => {
	t.deepEqual(
		parseWebClientEvent(
			JSON.stringify({
				type: 'hello',
				protocolVersion: WEB_PROTOCOL_VERSION,
			}),
		),
		{type: 'hello', protocolVersion: WEB_PROTOCOL_VERSION},
	);

	t.deepEqual(
		parseWebClientEvent(
			JSON.stringify({
				type: 'user_message',
				id: 'turn-1',
				text: 'hello',
			}),
		),
		{type: 'user_message', id: 'turn-1', text: 'hello'},
	);
});

test('parseWebClientEvent accepts a reset_session event', t => {
	t.deepEqual(
		parseWebClientEvent(
			JSON.stringify({
				type: 'reset_session',
				id: 'browser-reset-1',
			}),
		),
		{type: 'reset_session', id: 'browser-reset-1'},
	);

	t.throws(
		() => parseWebClientEvent(JSON.stringify({type: 'reset_session'})),
		{message: 'Reset session id is required.'},
	);
});

test('parseWebClientEvent rejects malformed interaction responses', t => {
	t.throws(
		() =>
			parseWebClientEvent(
				JSON.stringify({type: 'approval_response', id: 'a', approved: 'yes'}),
			),
		{message: 'Approval response approved flag is required.'},
	);

	t.throws(
		() =>
			parseWebClientEvent(
				JSON.stringify({type: 'question_response', id: 'q', answer: 12}),
			),
		{message: 'Question response answer is required.'},
	);

	t.throws(
		() =>
			parseWebClientEvent(
				JSON.stringify({type: 'approval_response', approved: false}),
			),
		{message: 'Approval response id is required.'},
	);
});
