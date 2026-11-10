import test from 'ava';
import type {ModelMessage} from 'ai';
import {jsonSchema, tool} from 'ai';
import type {AISDKCoreTool} from '@/types/index';
import {appendTurnContext} from '@/utils/turn-context';
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

// --- #1574 regression: per-turn context must not break the prefix ---
//
// Skills and recalled memories used to be appended to the system prompt, which
// made the system block differ on every user message. These two tests pin the
// difference the turn-context move makes, in the terms the tracker reports.

test('per-turn context in the system prompt breaks the prefix every turn', async t => {
	const tracker = new PrefixTracker();
	const base = 'You are Nanocoder.';
	await tracker.record(`${base}\n\n## Project Context\n- Auth uses Clerk.`, {readFile}, [user('refactor auth')]);

	t.deepEqual(
		await tracker.record(`${base}\n\n## Available Skills\n- changelog`, {readFile}, [
			user('refactor auth'),
			assistant('done'),
			user('update the changelog'),
		]),
		{kind: 'system-changed'},
	);
});

test('per-turn context in the user message keeps the prefix append-only', async t => {
	const tracker = new PrefixTracker();
	const base = 'You are Nanocoder.';
	const turnOne = appendTurnContext('refactor auth', [
		'## Project Context\n- Auth uses Clerk.',
	]);
	await tracker.record(base, {readFile}, [user(turnOne)]);

	t.deepEqual(
		await tracker.record(base, {readFile}, [
			user(turnOne),
			assistant('done'),
			user(appendTurnContext('update the changelog', ['## Available Skills\n- changelog'])),
		]),
		{kind: 'append-only', reusedMessages: 1},
	);
});

// --- schema digest caching ---
//
// ToolRegistry.getNativeTools strips `execute` with a rest-spread, so the tool
// objects handed to the client are fresh on every request while `inputSchema`
// survives the shallow copy. A cache keyed on the tool therefore never hits —
// which is what these pin, since the wasted work (resolve + stringify + hash
// of every schema) is paid per request whether or not anything logs it.

/** Mimic getNativeTools: a new object per call, same inputSchema reference. */
function restripped(source: AISDKCoreTool): AISDKCoreTool {
	const {execute: _execute, ...rest} = source as AISDKCoreTool & {
		execute?: unknown;
	};
	return rest as AISDKCoreTool;
}

test('a schema is serialised once across requests, not once per request', async t => {
	// The SDK memoizes schema *resolution* on the Schema object, so the work
	// that actually repeats is serialising it. toJSON counts each pass.
	let serialisations = 0;
	const countingTool = tool({
		description: 'Read a file',
		inputSchema: jsonSchema({
			type: 'object',
			properties: {path: {type: 'string'}},
			toJSON() {
				serialisations += 1;
				return {type: 'object', properties: {path: {type: 'string'}}};
			},
		} as never),
	});

	await fingerprintPrompt('sys', {readFile: restripped(countingTool)}, []);
	await fingerprintPrompt('sys', {readFile: restripped(countingTool)}, []);

	t.is(serialisations, 1);
});

test('two tools sharing one schema object still hash differently', async t => {
	// Nothing enforces one-schema-per-tool, so the cache must not key a whole
	// tool's hash on its schema: that would collide and hide a real change.
	const shared = jsonSchema({type: 'object', properties: {}});
	const first = await fingerprintPrompt(
		'sys',
		{act: tool({description: 'First', inputSchema: shared})},
		[],
	);
	const second = await fingerprintPrompt(
		'sys',
		{act: tool({description: 'Second', inputSchema: shared})},
		[],
	);

	t.not(first.toolsHash, second.toolsHash);
});
