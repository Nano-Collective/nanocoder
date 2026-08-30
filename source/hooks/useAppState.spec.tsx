import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {cleanup, render} from 'ink-testing-library';
import React from 'react';
import {Box} from 'ink';
// CRITICAL: redirect preference reads to a temp dir BEFORE useAppState
// initializes. useAppState reads loadPreferences() at mount; isolating it
// keeps tests deterministic regardless of the local user's settings.
process.env.NANOCODER_CONFIG_DIR = mkdtempSync(
	join(tmpdir(), 'nanocoder-spec-'),
);
const {resetPreferencesCache} = await import('@/config/preferences');
resetPreferencesCache();

import type {DevelopmentMode, Message} from '@/types/core';
import {useAppState} from './useAppState';

console.log('\nuseAppState.spec.tsx');

type AppStateHook = ReturnType<typeof useAppState>;

let captured: AppStateHook | null = null;
// Module-level, so it only holds up because AVA runs this suite serially -
// same constraint the `captured` global above already relies on.
let renderCount = 0;

function Probe({initialMode}: {initialMode?: DevelopmentMode}) {
	renderCount++;
	captured = useAppState(initialMode ?? 'normal');
	return null;
}

// Mirrors the cacheKey formula in getMessageTokens (useAppState.tsx). If that
// formula changes, change this too or the assertions below silently drift.
// Defaults match useAppState's initial provider/model state.
function tokenCacheKey(
	message: Message,
	model = '',
	provider = 'openai-compatible',
) {
	return (message.content || '') + message.role + provider + model;
}

function setup(initialMode: DevelopmentMode = 'normal') {
	captured = null;
	renderCount = 0;
	const instance = render(<Probe initialMode={initialMode} />);
	if (!captured) throw new Error('useAppState did not initialize');
	return {hook: captured as AppStateHook, instance};
}

test.afterEach(() => {
	cleanup();
	captured = null;
});

test('returns initial state with sensible defaults', t => {
	const {hook} = setup();

	t.is(hook.client, null);
	t.deepEqual(hook.messages, []);
	t.is(hook.currentModel, '');
	t.is(hook.currentProvider, 'openai-compatible');
	t.is(hook.currentProviderConfig, null);
	t.is(hook.activeMode, null);
	t.is(hook.isToolConfirmationMode, false);
	t.is(hook.isToolExecuting, false);
	t.is(hook.developmentMode, 'normal');
	t.is(hook.startChat, false);
	t.is(hook.mcpInitialized, false);
	t.is(hook.preferencesLoaded, false);
	t.is(hook.isCancelling, false);
	t.is(hook.subagentsReady, false);
	t.deepEqual(hook.pendingToolCalls, []);
});

test('respects initialDevelopmentMode argument', t => {
	const {hook} = setup('plan');
	t.is(hook.developmentMode, 'plan');
});

test('all derived mode booleans are false when activeMode is null', t => {
	const {hook} = setup();
	t.false(hook.isExplorerMode);
	t.false(hook.isIdeSelectionMode);
});

test('setActiveMode flips the matching derived boolean only', t => {
	const {hook, instance} = setup();

	hook.setActiveMode('explorer');
	instance.rerender(<Probe />);

	t.true(captured!.isExplorerMode);
	t.false(captured!.isIdeSelectionMode);
	t.is(captured!.activeMode, 'explorer');

	captured!.setActiveMode('ideSelection');
	instance.rerender(<Probe />);

	t.false(captured!.isExplorerMode);
	t.true(captured!.isIdeSelectionMode);

	captured!.setActiveMode(null);
	instance.rerender(<Probe />);

	t.false(captured!.isIdeSelectionMode);
	t.is(captured!.activeMode, null);
});


test('addToChatQueue appends component to chatComponents', t => {
	const {hook, instance} = setup();

	t.deepEqual(hook.chatComponents, []);

	hook.addToChatQueue(<Box>first</Box>);
	instance.rerender(<Probe />);

	t.is(captured!.chatComponents.length, 1);

	captured!.addToChatQueue(<Box>second</Box>);
	instance.rerender(<Probe />);

	t.is(captured!.chatComponents.length, 2);
});

test('addToChatQueue assigns a key when one is missing', t => {
	const {hook, instance} = setup();

	hook.addToChatQueue(<Box>no-key</Box>);
	instance.rerender(<Probe />);

	const first = captured!.chatComponents[0] as React.ReactElement;
	t.truthy(first.key);
	t.true(typeof first.key === 'string');
	t.regex(first.key as string, /^[0-9a-f]+-chat-component-\d+$/);
});

test('addToChatQueue preserves an existing key', t => {
	const {hook, instance} = setup();

	hook.addToChatQueue(<Box key="my-key">explicit</Box>);
	instance.rerender(<Probe />);

	const first = captured!.chatComponents[0] as React.ReactElement;
	t.is(first.key, 'my-key');
});

test('updateMessages updates messages', t => {
	const {hook, instance} = setup();

	const msgs: Message[] = [
		{role: 'user', content: 'hi'} as Message,
		{role: 'assistant', content: 'hello'} as Message,
	];

	hook.updateMessages(msgs);
	instance.rerender(<Probe />);

	t.deepEqual(captured!.messages, msgs);
});

test('updateMessages preserves the API usage snapshot across an in-conversation append', t => {
	const {hook, instance} = setup();

	// Establish a conversation, then capture a snapshot against it.
	const opening: Message = {role: 'user', content: 'first question'} as Message;
	hook.updateMessages([opening, {role: 'assistant', content: 'answer'} as Message]);
	hook.setLastApiUsage({inputTokens: 1000, outputTokens: 200, atMessageCount: 2});
	instance.rerender(<Probe />);
	t.not(captured!.lastApiUsage, null);

	// Appending a new user message keeps the prior messages as a prefix, so the
	// snapshot must survive — the indicator anchors on it and estimates the tail.
	captured!.updateMessages([
		opening,
		{role: 'assistant', content: 'answer'} as Message,
		{role: 'user', content: 'follow-up'} as Message,
	]);
	instance.rerender(<Probe />);

	t.not(captured!.lastApiUsage, null);
});

test('updateMessages invalidates the snapshot on a wholesale replacement (different first message)', t => {
	const {hook, instance} = setup();

	hook.updateMessages([{role: 'user', content: 'old conversation'} as Message]);
	hook.setLastApiUsage({inputTokens: 1000, outputTokens: 200, atMessageCount: 1});
	instance.rerender(<Probe />);
	t.not(captured!.lastApiUsage, null);

	// A swap to a different conversation (resume / checkpoint restore) changes the
	// opening message, so the snapshot no longer describes a prefix and is dropped.
	captured!.updateMessages([{role: 'user', content: 'a different session'} as Message]);
	instance.rerender(<Probe />);

	t.is(captured!.lastApiUsage, null);
});

test('updateMessages invalidates the snapshot when the history shrinks (/clear, /compact)', t => {
	const {hook, instance} = setup();

	hook.updateMessages([
		{role: 'user', content: 'q'} as Message,
		{role: 'assistant', content: 'a'} as Message,
	]);
	hook.setLastApiUsage({inputTokens: 1000, outputTokens: 200, atMessageCount: 2});
	instance.rerender(<Probe />);
	t.not(captured!.lastApiUsage, null);

	// /clear empties the array — shorter than before → snapshot dropped.
	captured!.updateMessages([]);
	instance.rerender(<Probe />);

	t.is(captured!.lastApiUsage, null);
});

test('reasoningExpandedRef tracks reasoningExpanded state', t => {
	const {hook, instance} = setup();

	const initialRef = hook.reasoningExpandedRef.current;
	t.is(initialRef, hook.reasoningExpanded);

	hook.setReasoningExpanded(!initialRef);
	instance.rerender(<Probe />);

	t.is(captured!.reasoningExpandedRef.current, !initialRef);
});

test('compactToolDisplayRef tracks compactToolDisplay state', t => {
	const {hook, instance} = setup();

	t.is(hook.compactToolDisplayRef.current, hook.compactToolDisplay);

	hook.setCompactToolDisplay(false);
	instance.rerender(<Probe />);

	t.is(captured!.compactToolDisplay, false);
	t.is(captured!.compactToolDisplayRef.current, false);
});

test('developmentModeRef tracks developmentMode state', t => {
	const {hook, instance} = setup();

	t.is(hook.developmentModeRef.current, hook.developmentMode);

	hook.setDevelopmentMode('yolo');
	instance.rerender(<Probe />);

	t.is(captured!.developmentMode, 'yolo');
	t.is(captured!.developmentModeRef.current, 'yolo');
});

test('tokenizer is rebuilt when provider or model changes', t => {
	const {hook, instance} = setup();

	const initial = hook.tokenizer;
	t.truthy(initial);

	hook.setCurrentProvider('ollama');
	hook.setCurrentModel('llama3');
	instance.rerender(<Probe />);

	t.not(captured!.tokenizer, initial);
});

test('getMessageTokens returns a number and caches it in place', t => {
	const {hook, instance} = setup();
	const cache = hook.messageTokenCache;

	const msg: Message = {role: 'user', content: 'hello world'} as Message;
	const tokens = hook.getMessageTokens(msg);

	t.is(typeof tokens, 'number');
	t.true(tokens >= 0);
	t.is(cache.size, 1);
	t.is(cache.get(tokenCacheKey(msg)), tokens);

	t.is(hook.getMessageTokens(msg), tokens);
	t.is(cache.size, 1);

	instance.rerender(<Probe />);

	t.is(captured!.messageTokenCache, cache);
	t.is(captured!.messageTokenCache.get(tokenCacheKey(msg)), tokens);
});

test('getMessageTokens returns a cached entry instead of recomputing', t => {
	const {hook} = setup();

	const msg: Message = {role: 'user', content: 'seeded'} as Message;
	t.true(hook.getMessageTokens(msg) > 0);

	hook.messageTokenCache.set(tokenCacheKey(msg), 0);

	t.is(hook.getMessageTokens(msg), 0);
	t.is(hook.messageTokenCache.size, 1);
});

test('a cache miss neither re-renders nor invalidates getMessageTokens', async t => {
	const {hook, instance} = setup();
	const rendersAfterMount = renderCount;
	const {getMessageTokens} = hook;

	getMessageTokens({role: 'user', content: 'uncached'} as Message);
	// Two macrotask turns: enough for a stray queued microtask or a React
	// scheduler callback to land, with no wall-clock sleep to flake on.
	await new Promise(resolve => setImmediate(resolve));
	await new Promise(resolve => setImmediate(resolve));

	t.is(renderCount, rendersAfterMount);

	instance.rerender(<Probe />);

	t.is(captured!.getMessageTokens, getMessageTokens);
	t.is(captured!.messageTokenCache.size, 1);
});

test('token cache keys separate content, role and model', t => {
	const {hook, instance} = setup();
	const cache = hook.messageTokenCache;
	const user: Message = {role: 'user', content: 'same text'} as Message;

	const userTokens = hook.getMessageTokens(user);
	hook.getMessageTokens({role: 'assistant', content: 'same text'} as Message);
	hook.getMessageTokens({role: 'user', content: 'other text'} as Message);

	t.is(cache.size, 3);

	hook.setCurrentModel('gpt-4o');
	instance.rerender(<Probe />);
	const switchedTokens = captured!.getMessageTokens(user);

	t.is(captured!.messageTokenCache, cache);
	t.is(cache.size, 4);
	t.is(cache.get(tokenCacheKey(user)), userTokens);
	t.is(cache.get(tokenCacheKey(user, 'gpt-4o')), switchedTokens);
});

test('token cache keys separate providers serving the same model', t => {
	const {hook, instance} = setup();
	const cache = hook.messageTokenCache;
	const msg: Message = {role: 'user', content: 'same text'} as Message;

	// One model name, two providers that resolve to different tokenizers:
	// openai-compatible gives the OpenAI tokenizer, ollama gives the Llama one.
	// Keying on the model alone would serve the second lookup a count the first
	// tokenizer produced.
	hook.setCurrentModel('shared-model');
	instance.rerender(<Probe />);
	const openaiTokens = captured!.getMessageTokens(msg);

	captured!.setCurrentProvider('ollama');
	instance.rerender(<Probe />);
	const ollamaTokens = captured!.getMessageTokens(msg);

	t.is(cache.size, 2);
	t.is(
		cache.get(tokenCacheKey(msg, 'shared-model', 'openai-compatible')),
		openaiTokens,
	);
	t.is(cache.get(tokenCacheKey(msg, 'shared-model', 'ollama')), ollamaTokens);
	t.not(ollamaTokens, openaiTokens);
});

test('token cache stays bounded and evicts the oldest entry', t => {
	const {hook} = setup();
	const cache = hook.messageTokenCache;
	const oldest: Message = {role: 'user', content: 'message 0'} as Message;
	const newest: Message = {role: 'user', content: 'message 1000'} as Message;

	for (let i = 0; i <= 1000; i++) {
		hook.getMessageTokens({role: 'user', content: `message ${i}`} as Message);
	}

	t.is(cache.size, 1000);
	t.is(cache.get(tokenCacheKey(oldest)), undefined);
	t.true(cache.get(tokenCacheKey(newest))! > 0);

	const recomputed = hook.getMessageTokens(oldest);

	t.is(cache.size, 1000);
	t.is(cache.get(tokenCacheKey(oldest)), recomputed);
});

test('getMessageTokens handles messages without content', t => {
	const {hook} = setup();
	const empty: Message = {role: 'user', content: ''} as Message;
	const missing = {role: 'user'} as unknown as Message;

	const emptyTokens = hook.getMessageTokens(empty);

	t.is(typeof emptyTokens, 'number');
	t.is(hook.getMessageTokens(missing), emptyTokens);
	t.is(hook.messageTokenCache.size, 1);
});

test('exposes setters for every state slice', t => {
	const {hook} = setup();

	const setterNames: Array<keyof typeof hook> = [
		'setClient',
		'setMessages',
		'setCurrentModel',
		'setCurrentProvider',
		'setCurrentProviderConfig',
		'setActiveMode',
		'setDevelopmentMode',
		'setTune',
		'setIsToolConfirmationMode',
		'setIsToolExecuting',
		'setAbortController',
		'setLiveComponent',
	];

	for (const name of setterNames) {
		t.is(typeof hook[name], 'function', `expected ${name} to be a function`);
	}
});

test('toggleTodoList toggles showTodoList and clears todoHasUnread when opening', t => {
	const {hook, instance} = setup();

	t.true(hook.showTodoList);
	t.false(hook.todoHasUnread);

	// Hide
	hook.toggleTodoList();
	instance.rerender(<Probe />);
	t.false(captured!.showTodoList);

	// Update tasks while hidden -> sets todoHasUnread
	captured!.setLiveTaskList([
		{id: '1', title: 'Task 1', status: 'pending', createdAt: '', updatedAt: ''},
	]);
	instance.rerender(<Probe />);
	t.true(captured!.todoHasUnread);

	// Toggle visible -> clears todoHasUnread
	captured!.toggleTodoList();
	instance.rerender(<Probe />);
	t.true(captured!.showTodoList);
	t.false(captured!.todoHasUnread);
});

test('setLiveTaskList clears todoHasUnread when tasks become empty or null', t => {
	const {hook, instance} = setup();

	// Hide
	hook.toggleTodoList();
	instance.rerender(<Probe />);
	t.false(captured!.showTodoList);

	// Add tasks
	captured!.setLiveTaskList([
		{id: '1', title: 'Task 1', status: 'pending', createdAt: '', updatedAt: ''},
	]);
	instance.rerender(<Probe />);
	t.true(captured!.todoHasUnread);

	// Clear tasks
	captured!.setLiveTaskList(null);
	instance.rerender(<Probe />);
	t.false(captured!.todoHasUnread);
});

