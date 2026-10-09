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
	await waitForSaves(1);
	const completed: Message[] = [...messages, {role: 'assistant', content: 'Done'}];
	view.rerender(<Probe history={completed} complete={true} />);
	await waitForSaves(2);
	view.rerender(<Probe history={[...completed, {role: 'assistant', content: 'Idle update'}]} complete={true} />);
	await new Promise(resolve => setTimeout(resolve, 50));
	t.is(saves, 2);
	view.rerender(<Probe history={completed} complete={false} />);
	await new Promise(resolve => setTimeout(resolve, 20));
	view.rerender(<Probe history={[...completed, {role: 'assistant', content: 'Next turn'}]} complete={true} />);
	await waitForSaves(3);
	await new Promise(resolve => setTimeout(resolve, 50));
	t.is(saves, 3);
});

test('TUI autosave generates the same smart title as ACP and publishes the saved name', async t => {
	await sessionManager.initialize();
	const messages: Message[] = [
		{role: 'user', content: 'fix this'},
		{role: 'assistant', content: 'Fixed the login redirect.', tool_calls: [{id: 'read', function: {name: 'read_file', arguments: {path: 'login.ts'}}}]},
	];
	const session = await sessionManager.createSession({title: 'fix this', provider: 'test', model: 'test', workingDirectory: process.cwd(), messageCount: messages.length, messages});
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
