import test from 'ava';
import type {ToolCall} from '@/types/core';
import {createHeadlessRetryGuards} from './headless-retry-guards';

console.log('\nheadless-retry-guards.spec.ts');

const limits = {
	maxRepeatedToolCalls: 3,
	maxEmptyTurns: 1,
	maxMalformedRetries: 1,
	maxTruncatedTurns: 1,
};

const call = (path: string, id = path): ToolCall => ({
	id,
	function: {name: 'read_file', arguments: {path}},
});

test('toolCalls stops on the cap-th identical turn, whatever the ids', t => {
	const guards = createHeadlessRetryGuards(limits);
	t.is(guards.toolCalls([call('/a', '1')]), null);
	t.is(guards.toolCalls([call('/a', '2')]), null);
	t.regex(guards.toolCalls([call('/a', '3')]) ?? '', /3 times in a row/);
});

test('toolCalls restarts the streak when the call changes', t => {
	const guards = createHeadlessRetryGuards(limits);
	guards.toolCalls([call('/a')]);
	guards.toolCalls([call('/a')]);
	t.is(guards.toolCalls([call('/b')]), null);
	t.is(guards.toolCalls([call('/b')]), null);
});

test('another kind of failing turn breaks the repeated-call streak', t => {
	const guards = createHeadlessRetryGuards(limits);
	guards.toolCalls([call('/a')]);
	guards.toolCalls([call('/a')]);
	guards.empty();
	t.is(guards.toolCalls([call('/a')]), null);
});

test('empty and malformed retry up to their cap, then stop', t => {
	const guards = createHeadlessRetryGuards(limits);
	t.deepEqual(guards.empty(), {action: 'retry', attempt: 1});
	t.is(guards.empty().action, 'stop');
	t.deepEqual(guards.malformed(), {action: 'retry', attempt: 1});
	t.is(guards.malformed().action, 'stop');
});

test('a tool-call turn resets the empty and malformed streaks', t => {
	const guards = createHeadlessRetryGuards(limits);
	guards.empty();
	guards.malformed();
	guards.toolCalls([call('/a')]);
	t.is(guards.empty().action, 'retry');
	guards.toolCalls([call('/b')]);
	t.is(guards.malformed().action, 'retry');
});

test('truncated continues up to the cap across the run', t => {
	const guards = createHeadlessRetryGuards(limits);
	t.deepEqual(guards.truncated(), {action: 'retry', attempt: 1});
	guards.toolCalls([call('/a')]);
	t.is(guards.truncated().action, 'stop');
});
