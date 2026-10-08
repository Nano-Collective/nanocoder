import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {sessionManager} from '@/session/session-manager';
import type {LLMClient, Message} from '@/types/core';
import {useSessionAutosave} from './useSessionAutosave';

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
