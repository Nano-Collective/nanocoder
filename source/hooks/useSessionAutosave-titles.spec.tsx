import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {sessionManager} from '@/session/session-manager';
import type {LLMClient, Message} from '@/types/core';
import {useSessionAutosave} from './useSessionAutosave';

test('completion replaces the debounce once per turn and idle updates do not flush again', async t => {
	await sessionManager.initialize();
	const messages: Message[] = [{role: 'user', content: 'First prompt'}];
	const session = await sessionManager.createSession({title: 'First prompt', provider: 'test', model: 'test', workingDirectory: process.cwd(), messageCount: 1, messages});
	t.teardown(() => sessionManager.deleteSession(session.id));
	let saves = 0;
	const unsubscribe = sessionManager.subscribeToSaves(saved => {if (saved.id === session.id) saves++;});
	t.teardown(unsubscribe);
	function Probe({history, complete}: {history: Message[]; complete: boolean}) {
		useSessionAutosave({messages: history, currentProvider: 'test', currentModel: 'test', currentSessionId: session.id, setCurrentSessionId: () => {}, isConversationComplete: complete});
		return null;
	}
	const view = render(<Probe history={messages} complete={false} />);
	t.teardown(() => view.unmount());
	const waitForSaves = async (count: number) => {
		for (let i = 0; saves < count && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
		t.is(saves, count);
	};
	await new Promise(resolve => setTimeout(resolve, 50));
	t.is(saves, 0);
	const completed: Message[] = [...messages, {role: 'assistant', content: 'Done'}];
	view.rerender(<Probe history={completed} complete={true} />);
	await waitForSaves(1);
	view.rerender(<Probe history={[...completed, {role: 'assistant', content: 'Idle update'}]} complete={true} />);
	await new Promise(resolve => setTimeout(resolve, 50));
	t.is(saves, 1);
	view.rerender(<Probe history={completed} complete={false} />);
	await new Promise(resolve => setTimeout(resolve, 20));
	view.rerender(<Probe history={[...completed, {role: 'assistant', content: 'Next turn'}]} complete={true} />);
	await waitForSaves(2);
	await new Promise(resolve => setTimeout(resolve, 50));
	t.is(saves, 2);
});

test('TUI autosave generates the same smart title as ACP and publishes the saved name', async t => {
	await sessionManager.initialize();
	const messages: Message[] = [
		{role: 'user', content: 'fix this'},
		{role: 'assistant', content: 'Fixed the login redirect.', tool_calls: [{id: 'read', function: {name: 'read_file', arguments: {path: 'login.ts'}}}]},
	];
	const session = await sessionManager.createSession({title: 'fix this', provider: 'test', model: 'test', workingDirectory: process.cwd(), messageCount: 1, messages: messages.slice(0, 1)});
	t.teardown(() => sessionManager.deleteSession(session.id));
	let flush: (() => Promise<void>) | undefined;
	const client = {chat: async () => ({choices: [{message: {role: 'assistant', content: 'Fix Login Redirect'}}]})} as unknown as LLMClient;
	let resolveTitle: (() => void) | undefined;
	const titled = new Promise<void>(resolve => {resolveTitle = resolve;});
	const unsubscribe = sessionManager.subscribeToSaves(saved => {if (saved.id === session.id && saved.titleGenerated) resolveTitle?.();});
	t.teardown(unsubscribe);
	function Probe() {
		const autosave = useSessionAutosave({messages, currentProvider: 'test', currentModel: 'test', currentSessionId: session.id, setCurrentSessionId: () => {}, client, isConversationComplete: true});
		flush = autosave.flush;
		return null;
	}
	const view = render(<Probe />);
	t.teardown(() => view.unmount());
	await new Promise(resolve => setTimeout(resolve, 20));
	await flush!();
	await titled;
	t.is((await sessionManager.readSession(session.id))?.title, 'Fix Login Redirect');
});

test('opening a saved chat does not bump its activity timestamp', async t => {
	await sessionManager.initialize();
	const messages: Message[] = [{role: 'user', content: 'resume me'}, {role: 'assistant', content: 'Sure.'}];
	const created = await sessionManager.createSession({title: 'resume me', provider: 'test', model: 'test', workingDirectory: process.cwd(), messageCount: 2, messages});
	t.teardown(() => sessionManager.deleteSession(created.id));
	const lastUsed = '2025-01-01T00:00:00.000Z';
	await sessionManager.saveSession({...created, lastAccessedAt: lastUsed});
	let saves = 0;
	const unsubscribe = sessionManager.subscribeToSaves(saved => {if (saved.id === created.id) saves++;});
	t.teardown(unsubscribe);
	// Opening a chat hands the stored messages to the hook, the same way applySession does.
	const loaded = await sessionManager.readSession(created.id);
	let flush: (() => Promise<void>) | undefined;
	function Probe({history}: {history: Message[]}) {
		const autosave = useSessionAutosave({messages: history, currentProvider: 'test', currentModel: 'test', currentSessionId: created.id, setCurrentSessionId: () => {}});
		flush = autosave.flush;
		return null;
	}
	const view = render(<Probe history={loaded!.messages} />);
	t.teardown(() => view.unmount());
	await new Promise(resolve => setTimeout(resolve, 50));
	await flush!();
	await new Promise(resolve => setTimeout(resolve, 50));
	t.is(saves, 0);
	t.is((await sessionManager.readSession(created.id))?.lastAccessedAt, lastUsed);
});
