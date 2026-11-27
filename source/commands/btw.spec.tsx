import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {btwCommand, buildBtwMessages, runBtwRequest} from '@/commands/btw';
import {lazyCommands} from '@/commands/lazy-registry';
import {BtwDisplay} from '@/components/btw/btw-display';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {ApiCallRecord, LLMClient, Message} from '@/types/core';
import type {CommandContext} from '@/types/index';

console.log('\nbtw.spec.tsx');

test('lazy registry includes btw command', t => {
	const entry = lazyCommands.find(c => c.name === 'btw');
	t.truthy(entry);
	t.regex(
		entry!.description.toLowerCase(),
		/side question|conversation history/,
	);
});

test('btwCommand exports expected stateful command', t => {
	t.is(btwCommand.name, 'btw');
	t.truthy(btwCommand.description);
	t.is(typeof btwCommand.run, 'function');
});

test('buildBtwMessages snapshots conversation, strips system/internal/tool messages, and disables history mutation', t => {
	const messages: Message[] = [
		{role: 'system', content: 'system prompt'},
		{role: 'user', content: 'first question'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call-1',
					function: {name: 'read_file', arguments: {path: 'a.ts'}},
				},
			],
		},
		{
			role: 'tool',
			tool_call_id: 'call-1',
			name: 'read_file',
			content: 'file contents',
		},
		{role: 'assistant', content: 'first answer'},
		{
			role: 'user',
			content: '<nanocoder-internal-walkthrough>\ninternal',
		},
	];

	const btwMessages = buildBtwMessages(messages, 'what does this do?');

	t.is(btwMessages[0]?.role, 'system');
	t.true(String(btwMessages[0]?.content).includes('ephemeral'));
	t.deepEqual(
		btwMessages.slice(1).map(m => ({role: m.role, content: m.content})),
		[
			{role: 'user', content: 'first question'},
			{role: 'assistant', content: 'first answer'},
			{role: 'user', content: 'what does this do?'},
		],
	);
	// Original history is untouched
	t.is(messages.length, 6);
});

test('runBtwRequest sends tool-free request and records usage', async t => {
	const records: ApiCallRecord[] = [];
	let capturedTools: unknown;
	let capturedModeOverrides: unknown;
	let capturedMessages: Message[] | undefined;

	const client = {
		chat: async (
			msgs: Message[],
			tools: unknown,
			_callbacks: unknown,
			_signal?: AbortSignal,
			modeOverrides?: unknown,
		) => {
			capturedMessages = msgs;
			capturedTools = tools;
			capturedModeOverrides = modeOverrides;
			return {
				choices: [{message: {role: 'assistant', content: 'It is a flag.'}}],
				usage: {inputTokens: 10, outputTokens: 5, totalTokens: 15},
			};
		},
		getProviderConfig: () => ({config: {baseURL: 'https://example.test/v1'}}),
	} as unknown as LLMClient;

	const result = await runBtwRequest({
		client,
		messages: [{role: 'user', content: 'refactor this'}],
		question: 'what does this flag do?',
		provider: 'test-provider',
		model: 'test-model',
		signal: new AbortController().signal,
		onToken: () => {},
		onApiCallComplete: record => records.push(record),
	});

	t.is(result.answer, 'It is a flag.');
	t.deepEqual(capturedTools, {});
	t.deepEqual(capturedModeOverrides, {
		nonInteractiveMode: false,
		nonInteractiveAlwaysAllow: [],
	});
	t.is(capturedMessages?.[0]?.role, 'system');
	t.is(
		capturedMessages?.[capturedMessages.length - 1]?.content,
		'what does this flag do?',
	);
	t.is(records.length, 1);
	t.is(records[0]?.provider, 'test-provider');
	t.is(records[0]?.model, 'test-model');
	t.is(records[0]?.inputTokens, 10);
	t.is(records[0]?.outputTokens, 5);
	t.is(records[0]?.baseURL, 'https://example.test/v1');
});

test('runBtwRequest does not record usage when none reported', async t => {
	const records: ApiCallRecord[] = [];
	const client = {
		chat: async () => ({
			choices: [{message: {role: 'assistant', content: 'ok'}}],
		}),
		getProviderConfig: () => ({config: {}}),
	} as unknown as LLMClient;

	await runBtwRequest({
		client,
		messages: [],
		question: 'q',
		provider: 'p',
		model: 'm',
		signal: new AbortController().signal,
		onToken: () => {},
		onApiCallComplete: record => records.push(record),
	});

	t.deepEqual(records, []);
});

test('BtwDisplay renders question and closes on Escape', async t => {
	let closed = 0;
	const {lastFrame, stdin} = renderWithTheme(
		<BtwDisplay
			question="what does this flag do?"
			interactive
			onClose={() => {
				closed++;
			}}
			runRequest={async () => ({answer: 'It enables strict mode.'})}
		/>,
	);

	const waitFor = async (condition: () => boolean, timeoutMs = 5000) => {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			if (condition()) return;
			await new Promise(resolve => setTimeout(resolve, 20));
		}
		throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
	};

	await waitFor(() => /strict mode/i.test(stripAnsi(lastFrame() ?? '')));
	t.regex(stripAnsi(lastFrame() ?? ''), /what does this flag do\?/i);

	await new Promise(resolve => setTimeout(resolve, 100));
	stdin.write('\u001B');
	await waitFor(() => closed === 1);
	t.is(closed, 1);
});

test('btw run uses pinned panel so main turn liveComponent clears do not dismiss it', async t => {
	let btwPanel: React.ReactNode = null;
	let liveComponent: React.ReactNode = null;
	let capturesInput = false;

	const context = {
		argText: 'what is this?',
		messages: [{role: 'user', content: 'hi'}],
		provider: 'test-provider',
		model: 'test-model',
		client: {
			chat: async () => ({
				choices: [{message: {role: 'assistant', content: 'answer'}}],
				usage: {inputTokens: 1, outputTokens: 1, totalTokens: 2},
			}),
			getProviderConfig: () => ({config: {}}),
		} as unknown as LLMClient,
		addToChatQueue: () => {},
		setLiveComponent: (component: React.ReactNode) => {
			liveComponent = component;
		},
		setBtwPanel: (component: React.ReactNode) => {
			btwPanel = component;
		},
		setLiveComponentCapturesInput: (value: boolean) => {
			capturesInput = value;
		},
		onApiCallComplete: () => {},
	} as unknown as CommandContext;

	const completion = await btwCommand.run(context);
	t.true(typeof completion === 'object' && completion !== null && 'until' in completion);
	t.truthy(btwPanel);
	t.true(capturesInput);

	// Simulate main turn clearing the regular live component slot.
	context.setLiveComponent(null);
	t.is(liveComponent, null);
	t.truthy(btwPanel);
	t.true(capturesInput);

	const panel = btwPanel as React.ReactElement<{onClose: () => void}>;
	panel.props.onClose();
	await (completion as {until: Promise<void>}).until;

	t.is(btwPanel, null);
	t.false(capturesInput);
});
