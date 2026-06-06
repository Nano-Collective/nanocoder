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

function Probe({initialMode}: {initialMode?: DevelopmentMode}) {
	captured = useAppState(initialMode ?? 'normal');
	return null;
}

function setup(initialMode: DevelopmentMode = 'normal') {
	captured = null;
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

test('updateMessages invalidates the API usage snapshot', t => {
	const {hook, instance} = setup();

	hook.setLastApiUsage({inputTokens: 1000, outputTokens: 200, atMessageCount: 2});
	instance.rerender(<Probe />);
	t.not(captured!.lastApiUsage, null);

	// Any wholesale message replacement (new turn, /clear, /compact, session
	// resume, checkpoint restore) must clear the snapshot so the context
	// indicator falls back to estimation rather than showing a stale API value.
	captured!.updateMessages([{role: 'user', content: 'hi'} as Message]);
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

test('tokenizer is rebuilt when provider or model changes', t => {
	const {hook, instance} = setup();

	const initial = hook.tokenizer;
	t.truthy(initial);

	hook.setCurrentProvider('ollama');
	hook.setCurrentModel('llama3');
	instance.rerender(<Probe />);

	t.not(captured!.tokenizer, initial);
});

test('getMessageTokens returns a number and caches the result', t => {
	const {hook} = setup();

	const msg: Message = {role: 'user', content: 'hello world'} as Message;
	const tokens = hook.getMessageTokens(msg);

	t.is(typeof tokens, 'number');
	t.true(tokens >= 0);
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
