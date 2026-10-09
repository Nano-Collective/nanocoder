import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {useWebRuntime} from './useWebRuntime';
import {createWebRuntimeBridge} from '@/web/runtime-bridge';
import type {WebServerEvent} from '@/web/protocol';

test('browser integration reads current state after rerender and unbinds on trust loss', async t => {
	const events: WebServerEvent[] = [];
	const bridge = createWebRuntimeBridge(event => events.push(event));
	const submitted: string[] = [];
	const props = {
		bridge,
		state: {currentSessionId: null, sessionName: '', messages: [], currentProvider: 'local', currentModel: 'small', developmentMode: 'normal', client: {}, toolManager: {}, liveTaskList: [], setSessionName: () => {}, ensureCurrentSessionId: () => 'test'},
		handlers: {handleMessageSubmit: async (text: string) => {submitted.push(text);}, clearMessages: async () => {}, handleCancel: () => {}},
		modes: {}, isGenerating: false, trusted: true, trustError: null, flushSession: async () => {},
	} as unknown as Parameters<typeof useWebRuntime>[0];
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
	view.rerender(<Probe value={{...next, trusted: false}} />);
	await new Promise(resolve => setTimeout(resolve, 20));
	t.like(bridge.getStateEvents()[0], {runtimeReady: false});
	await t.throwsAsync(bridge.handleClientEvent({type: 'user_message', id: 'blocked', text: 'hello'}));
});
