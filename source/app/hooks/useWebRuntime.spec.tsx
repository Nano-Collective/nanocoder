import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {useWebRuntime} from './useWebRuntime';
import {createWebRuntimeBridge} from '@/web/runtime-bridge';
import type {WebServerEvent} from '@/web/protocol';
import type {LLMClient} from '@/types/core';
import {ToolManager} from '@/tools/tool-manager';
import {sessionManager} from '@/session/session-manager';

test('browser integration reads current state after rerender and unbinds on trust loss', async t => {
	const events: WebServerEvent[] = [];
	const bridge = createWebRuntimeBridge(event => events.push(event));
	const submitted: string[] = [];
	await sessionManager.initialize();
	const session = await sessionManager.createSession({title: 'Test', provider: 'local', model: 'small', workingDirectory: process.cwd(), messageCount: 0, messages: []});
	t.teardown(() => sessionManager.deleteSession(session.id));
	const client: LLMClient = {
		chat: async () => ({choices: [{message: {role: 'assistant', content: 'Done'}}]}),
		getCurrentModel: () => 'small', setModel: () => {},
		getContextSize: () => 8192, getAvailableModels: async () => ['small'],
		getProviderConfig: () => ({name: 'local'}), clearContext: async () => {},
	};
	const props: Parameters<typeof useWebRuntime>[0] = {
		bridge,
		state: {currentSessionId: session.id, sessionName: '', messages: [], currentProvider: 'local', currentModel: 'small', developmentMode: 'normal', client, toolManager: new ToolManager(), liveTaskList: [], setSessionName: () => {}, ensureCurrentSessionId: () => session.id, setDevelopmentMode: () => {}},
		handlers: {handleMessageSubmit: async (text: string) => {submitted.push(text);}, clearMessages: async () => {}, handleCancel: () => {}, applySession: () => {}},
		modes: {handleModelSelect: async () => true}, isGenerating: false, trusted: true, trustError: null, flushSession: async () => {},
	};
	function Probe({value}: {value: typeof props}) {useWebRuntime(value); return null;}
	const view = render(<Probe value={props} />);
	t.teardown(() => view.unmount());
	await new Promise(resolve => setTimeout(resolve, 20));
	t.like(bridge.getStateEvents()[0], {runtimeReady: true});
	const next = {...props, state: {...props.state, sessionName: 'Updated', messages: [{role: 'user' as const, content: 'Latest history'}]}};
	view.rerender(<Probe value={next} />);
	await new Promise(resolve => setTimeout(resolve, 20));
	t.like(bridge.getStateEvents()[0], {messages: [{content: 'Latest history'}]});
	await bridge.handleClientEvent({type: 'user_message', id: 'status', text: '/status'});
	await new Promise(resolve => setTimeout(resolve, 20));
	t.true(events.some(event => event.type === 'notice' && event.message.includes('Model: small')));
	t.deepEqual(submitted, []);
	await bridge.handleClientEvent({type: 'user_message', id: 'allowed', text: 'hello'});
	await new Promise(resolve => setTimeout(resolve, 20));
	t.deepEqual(submitted, ['hello']);
	view.rerender(<Probe value={{...next, trusted: false}} />);
	await new Promise(resolve => setTimeout(resolve, 20));
	t.like(bridge.getStateEvents()[0], {runtimeReady: false});
	await t.throwsAsync(bridge.handleClientEvent({type: 'user_message', id: 'blocked', text: 'hello'}));
	t.deepEqual(submitted, ['hello']);
});
