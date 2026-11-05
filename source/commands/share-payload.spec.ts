import test from 'ava';
import type {Message} from '@/types/index';
import {buildSharePayload, serializeSharePayload} from './share-payload';

console.log('\nshare-payload.spec.ts');

const META = {provider: 'test-provider', model: 'test-model'};
const NO_SECRETS_ENV = {};
const SECRET = 'sk-abcdefghijklmnopqrstuvwx';

const conversation: Message[] = [
	{role: 'system', content: 'You are nanocoder. Secret system prompt.'},
	{role: 'user', content: 'Read the config'},
	{
		role: 'assistant',
		content: 'Reading it.',
		reasoning: 'The user wants the config.',
		tool_calls: [
			{
				id: 'call_1',
				function: {name: 'read_file', arguments: {path: 'a.json', limit: 5}},
			},
		],
	},
	{role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: '{}'},
	{role: 'assistant', content: 'It is empty.'},
];

function build(messages: Message[], redact = true) {
	return buildSharePayload(messages, META, {redact, env: NO_SECRETS_ENV});
}

test('payload keeps the conversation and drops system messages', t => {
	const {payload} = build(conversation);

	t.is(payload.format, 'nanocoder-share');
	t.is(payload.version, 1);
	t.is(payload.provider, 'test-provider');
	t.is(payload.model, 'test-model');
	t.deepEqual(
		payload.messages.map(message => message.role),
		['user', 'assistant', 'tool', 'assistant'],
	);
	t.false(serializeSharePayload(payload).includes('Secret system prompt'));
	t.deepEqual(payload.messages[1], {
		role: 'assistant',
		content: 'Reading it.',
		reasoning: 'The user wants the config.',
		toolCalls: [
			{id: 'call_1', name: 'read_file', arguments: {limit: 5, path: 'a.json'}},
		],
	});
	t.deepEqual(payload.messages[2], {
		role: 'tool',
		content: '{}',
		toolCallId: 'call_1',
		name: 'read_file',
	});
});

test('payload has no timestamp or other per-call field', t => {
	const {payload} = build(conversation);
	t.deepEqual(Object.keys(payload), [
		'format',
		'version',
		'provider',
		'model',
		'redacted',
		'messages',
	]);
});

test('serialisation is byte-stable and ignores tool-argument key order', t => {
	const reordered: Message[] = conversation.map(message =>
		message.tool_calls
			? {
					...message,
					tool_calls: [
						{
							id: 'call_1',
							function: {
								name: 'read_file',
								arguments: {limit: 5, path: 'a.json'},
							},
						},
					],
				}
			: message,
	);

	const first = serializeSharePayload(build(conversation).payload);
	t.is(serializeSharePayload(build(conversation).payload), first);
	t.is(serializeSharePayload(build(reordered).payload), first);
	t.true(first.endsWith('}\n'));
});

test('image data is left out, only the media type is kept', t => {
	const {payload} = build([
		{
			role: 'user',
			content: 'What is in this screenshot?',
			images: [{data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', mediaType: 'image/png'}],
		},
	]);
	t.deepEqual(payload.messages[0]?.images, [{mediaType: 'image/png'}]);
	t.false(serializeSharePayload(payload).includes('iVBORw0KGgo'));
});

test('empty assistant turns are dropped, empty tool results are kept', t => {
	const {payload} = build([
		{role: 'user', content: 'Run it'},
		{role: 'assistant', content: '   '},
		{
			role: 'assistant',
			content: '',
			tool_calls: [{id: 'c', function: {name: 'execute_bash', arguments: {}}}],
		},
		{role: 'tool', tool_call_id: 'c', name: 'execute_bash', content: ''},
	]);
	t.deepEqual(
		payload.messages.map(message => message.role),
		['user', 'assistant', 'tool'],
	);
});

test('harness notices keep their displayOnly flag and outcome', t => {
	const {payload} = build([
		{role: 'user', content: 'Go'},
		{
			role: 'assistant',
			content: 'Interrupted',
			displayOnly: true,
			outcome: 'cancelled',
			durationMs: 1234,
		},
	]);
	t.deepEqual(payload.messages[1], {
		role: 'assistant',
		content: 'Interrupted',
		outcome: 'cancelled',
		displayOnly: true,
	});
});

test('redaction masks secrets in every message field and counts them', t => {
	const {payload, redactionCount} = buildSharePayload(
		[
			{role: 'user', content: `My key is ${SECRET}`},
			{
				role: 'assistant',
				content: 'Using it',
				reasoning: `Key ${SECRET} looks valid`,
				tool_calls: [
					{
						id: 'c',
						function: {
							name: 'execute_bash',
							arguments: {
								command: `curl -H "Authorization: Bearer ${SECRET}"`,
								env: {nested: ['hunter2-env-value']},
							},
						},
					},
				],
			},
			{
				role: 'tool',
				tool_call_id: 'c',
				name: 'execute_bash',
				content: 'token=config-key-1234567890',
			},
		],
		META,
		{
			redact: true,
			env: {MY_API_KEY: 'hunter2-env-value'},
			extraSecrets: ['config-key-1234567890'],
		},
	);

	const json = serializeSharePayload(payload);
	t.true(payload.redacted);
	t.false(json.includes(SECRET));
	t.false(json.includes('hunter2-env-value'));
	t.false(json.includes('config-key-1234567890'));
	t.is(payload.messages[0]?.content, 'My key is [REDACTED]');
	t.deepEqual(payload.messages[1]?.toolCalls?.[0]?.arguments, {
		command: 'curl -H "Authorization: Bearer [REDACTED]"',
		env: {nested: ['[REDACTED]']},
	});
	t.is(redactionCount, 5);
});

test('redaction does not count markers that were already in the session', t => {
	const {redactionCount} = build([
		{role: 'user', content: 'The log already says [REDACTED] here'},
	]);
	t.is(redactionCount, 0);
});

test('redact: false keeps the session as it is', t => {
	const {payload, redactionCount} = buildSharePayload(
		[{role: 'user', content: `My key is ${SECRET}`}],
		META,
		{redact: false, env: NO_SECRETS_ENV, extraSecrets: [SECRET]},
	);
	t.false(payload.redacted);
	t.is(payload.messages[0]?.content, `My key is ${SECRET}`);
	t.is(redactionCount, 0);
});
