import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {useWebRuntime} from './useWebRuntime';
import {createWebRuntimeBridge} from '@/web/runtime-bridge';
import type {WebServerEvent} from '@/web/protocol';
import type {LLMClient} from '@/types/core';
import {ToolManager} from '@/tools/tool-manager';
import {sessionManager} from '@/session/session-manager';
import {getAppConfig} from '@/config/index';
import {updateSubagentProgressById, removeSubagentProgress} from '@/services/subagent-events';

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
	const config = getAppConfig();
	const previousProviders = config.providers;
	config.providers = [{name: 'local', models: ['small']}];
	t.teardown(() => {config.providers = previousProviders;});
	const selectedModes: string[] = [];
	props.state.setDevelopmentMode = mode => {selectedModes.push(mode);};
	function Probe({value}: {value: typeof props}) {useWebRuntime(value); return null;}
	const view = render(<Probe value={props} />);
	t.teardown(() => view.unmount());
	await new Promise(resolve => setTimeout(resolve, 20));
	t.like(bridge.getStateEvents()[0], {runtimeReady: true});
	await bridge.handleClientEvent({type: 'update_settings', id: 'yolo', provider: 'local', model: 'small', mode: 'yolo'});
	t.deepEqual(selectedModes, ['yolo']);
	await bridge.handleClientEvent({type: 'load_session', id: 'load', sessionId: session.id});
	t.is((await sessionManager.readSession(session.id))?.lastAccessedAt, session.lastAccessedAt);
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
	// The service used by actual subagent execution feeds browser snapshots.
	await bridge.handleClientEvent({type: 'user_message', id: 'agent-turn', text: 'explore'});
	updateSubagentProgressById('web-agent-test', {subagentName: 'explore', status: 'tool_call', currentTool: 'read_file', toolCallCount: 1, turnCount: 1, tokenCount: 10});
	removeSubagentProgress('web-agent-test');
	const snapshot = bridge.getStateEvents()[0];
	if (snapshot.type !== 'state') throw new Error('Missing state');
	t.like(snapshot.work?.find(work => work.id === 'agent-turn'), {agents: [{id: 'web-agent-test', currentTool: 'read_file'}]});
	await new Promise(resolve => setTimeout(resolve, 20));
	view.rerender(<Probe value={{...next, trusted: false}} />);
	await new Promise(resolve => setTimeout(resolve, 20));
	t.like(bridge.getStateEvents()[0], {runtimeReady: false});
	await t.throwsAsync(bridge.handleClientEvent({type: 'user_message', id: 'blocked', text: 'hello'}));
	t.deepEqual(submitted, ['hello', 'explore']);
	await t.throwsAsync(bridge.handleClientEvent({type: 'update_settings', id: 'blocked-mode', provider: 'local', model: 'small', mode: 'yolo'}));
	t.deepEqual(selectedModes, ['yolo']);
});
