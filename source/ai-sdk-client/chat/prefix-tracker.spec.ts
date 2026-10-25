import test from 'ava';
import type {ModelMessage} from 'ai';
import {jsonSchema, tool} from 'ai';
import type {AISDKCoreTool} from '@/types/index';
import {
	comparePromptFingerprints,
	fingerprintPrompt,
	PrefixTracker,
} from './prefix-tracker.js';

console.log('\nprefix-tracker.spec.ts');

function makeTool(description: string): AISDKCoreTool {
	return tool({
		description,
		inputSchema: jsonSchema({
			type: 'object',
			properties: {path: {type: 'string'}},
		}),
	});
}

const readFile = makeTool('Read a file');
const writeFile = makeTool('Write a file');

const user = (text: string): ModelMessage => ({role: 'user', content: text});
const assistant = (text: string): ModelMessage => ({
	role: 'assistant',
	content: text,
});

test('first request has nothing to compare against', async t => {
	const tracker = new PrefixTracker();
	t.deepEqual(await tracker.record('sys', {readFile}, [user('hi')]), {
		kind: 'first',
	});
});

test('appending messages keeps the prefix', async t => {
	const tracker = new PrefixTracker();
	await tracker.record('sys', {readFile}, [user('hi')]);
	t.deepEqual(
		await tracker.record('sys', {readFile}, [
			user('hi'),
			assistant('hello'),
			user('next'),
		]),
		{kind: 'append-only', reusedMessages: 1},
	);
});

test('a changed system prompt is reported before anything else', async t => {
	const tracker = new PrefixTracker();
	await tracker.record('sys', {readFile}, [user('hi')]);
	t.deepEqual(
		await tracker.record('sys + per-turn skills', {writeFile}, [user('bye')]),
		{kind: 'system-changed'},
	);
});

test('added and removed tools are named', async t => {
	const tracker = new PrefixTracker();
	await tracker.record('sys', {readFile}, [user('hi')]);
	t.deepEqual(await tracker.record('sys', {writeFile}, [user('hi')]), {
		kind: 'tools-changed',
		added: ['writeFile'],
		removed: ['readFile'],
		reordered: false,
	});
});

test('reordering tools breaks the prefix', async t => {
	const tracker = new PrefixTracker();
	await tracker.record('sys', {readFile, writeFile}, [user('hi')]);
	t.deepEqual(
		await tracker.record('sys', {writeFile, readFile}, [user('hi')]),
		{kind: 'tools-changed', added: [], removed: [], reordered: true},
	);
});

test('a changed tool schema breaks the prefix', async t => {
	const tracker = new PrefixTracker();
	await tracker.record('sys', {readFile}, [user('hi')]);
	t.deepEqual(
		await tracker.record('sys', {readFile: makeTool('Read a file v2')}, [
			user('hi'),
		]),
		{kind: 'tools-changed', added: [], removed: [], reordered: false},
	);
});

test('rewritten history reports the first changed index', async t => {
	const tracker = new PrefixTracker();
	await tracker.record('sys', {readFile}, [
		user('a'),
		assistant('b'),
		user('c'),
	]);
	t.deepEqual(
		await tracker.record('sys', {readFile}, [
			user('a'),
			user('<conversation-summary>b</conversation-summary>'),
			user('c'),
		]),
		{kind: 'history-changed', index: 1, previousMessages: 3},
	);
});

test('a dropped leading message (sliding window) diverges at index 0', async t => {
	const tracker = new PrefixTracker();
	await tracker.record('sys', undefined, [user('a'), user('b')]);
	t.deepEqual(await tracker.record('sys', undefined, [user('b'), user('c')]), {
		kind: 'history-changed',
		index: 0,
		previousMessages: 2,
	});
});

test('reset forgets the previous request', async t => {
	const tracker = new PrefixTracker();
	await tracker.record('sys', undefined, [user('a')]);
	tracker.reset();
	t.deepEqual(await tracker.record('other', undefined, [user('b')]), {
		kind: 'first',
	});
});

test('fingerprints are deterministic for identical input', async t => {
	const a = await fingerprintPrompt('sys', {readFile, writeFile}, [user('x')]);
	const b = await fingerprintPrompt('sys', {readFile, writeFile}, [user('x')]);
	t.deepEqual(a, b);
	t.deepEqual(comparePromptFingerprints(a, b), {
		kind: 'append-only',
		reusedMessages: 1,
	});
});

test('overlapping records are compared in call order', async t => {
	const tracker = new PrefixTracker();
	const [first, second] = await Promise.all([
		tracker.record('sys', {readFile}, [user('a')]),
		tracker.record('sys', {readFile}, [user('a'), assistant('b')]),
	]);
	t.deepEqual(first, {kind: 'first'});
	t.deepEqual(second, {kind: 'append-only', reusedMessages: 1});
});
