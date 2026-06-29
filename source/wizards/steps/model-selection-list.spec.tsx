import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {FetchedModel} from '../utils/fetch-models';
import {ModelSelectionList} from './model-selection-list';

const wait = async (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));

const createModels = (count: number): FetchedModel[] =>
	Array.from({length: count}, (_, index) => ({
		id: `model-${String(index + 1).padStart(2, '0')}`,
		name: `Model ${String(index + 1).padStart(2, '0')}`,
	}));

function renderList({
	models = createModels(20),
	selectedIds = new Set<string>(),
	error = null,
	onToggle = () => {},
	onSelectAll = () => {},
	onDone = () => {},
	onBack = () => {},
	onManualEntry = () => {},
}: {
	models?: FetchedModel[];
	selectedIds?: Set<string>;
	error?: string | null;
	onToggle?: (modelId: string) => void;
	onSelectAll?: () => void;
	onDone?: () => void;
	onBack?: () => void;
	onManualEntry?: () => void;
} = {}) {
	return renderWithTheme(
		<ModelSelectionList
			models={models}
			selectedIds={selectedIds}
			title="OpenRouter Configuration"
			error={error}
			isNarrow={false}
			onToggle={onToggle}
			onSelectAll={onSelectAll}
			onDone={onDone}
			onBack={onBack}
			onManualEntry={onManualEntry}
		/>,
	);
}

test('renders an initial visible window only', t => {
	const {lastFrame, unmount} = renderList();
	const output = lastFrame() || '';

	t.regex(output, /0 selected \| 1-12\/20 models/);
	t.regex(output, /model-01/);
	t.regex(output, /model-12/);
	t.notRegex(output, /model-13/);
	t.regex(output, /Done is always available: press d/);

	unmount();
});

test('down arrow moves highlight and scrolls the visible window', async t => {
	const {stdin, lastFrame, unmount} = renderList();

	for (let i = 0; i < 12; i++) {
		stdin.write('\u001B[B');
		await wait(10);
	}

	const output = lastFrame() || '';
	t.regex(output, /model-13/);
	t.notRegex(output, /model-01/);

	unmount();
});

test('slash enters search mode and typing filters models', async t => {
	const models: FetchedModel[] = [
		{id: 'openai/gpt-4o', name: 'GPT-4o'},
		{id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4'},
		{id: 'google/gemini-pro', name: 'Gemini Pro'},
	];
	const {stdin, lastFrame, unmount} = renderList({models});

	stdin.write('/');
	await wait();
	for (const character of 'claude') {
		stdin.write(character);
		await wait(10);
	}
	await wait();

	// Strip ANSI so color codes (present when CI forces color) don't split the
	// "Search models: " label from the typed query in the matched text.
	const output = stripAnsi(lastFrame() || '');
	t.regex(output, /Search models: claude/);
	t.regex(output, /1-1\/1 models \| filter: claude/);
	t.regex(output, /Claude Sonnet 4 — anthropic\/claude-sonnet-4/);
	t.notRegex(output, /GPT-4o — openai\/gpt-4o/);
	t.notRegex(output, /Gemini Pro — google\/gemini-pro/);

	unmount();
});

test('space toggles the highlighted model', async t => {
	let toggledModelId: string | null = null;
	const {stdin, unmount} = renderList({
		onToggle: modelId => {
			toggledModelId = modelId;
		},
	});

	stdin.write(' ');
	await wait();

	t.is(toggledModelId, 'model-01');
	unmount();
});

test('a toggles select all and d completes selection', async t => {
	let selectAllCalls = 0;
	let doneCalls = 0;
	const {stdin, unmount} = renderList({
		onSelectAll: () => {
			selectAllCalls += 1;
		},
		onDone: () => {
			doneCalls += 1;
		},
	});

	stdin.write('a');
	await wait();
	stdin.write('d');
	await wait();

	t.is(selectAllCalls, 1);
	t.is(doneCalls, 1);
	unmount();
});

test('d in search mode updates the query instead of completing', async t => {
	let doneCalls = 0;
	const {stdin, lastFrame, unmount} = renderList({
		onDone: () => {
			doneCalls += 1;
		},
	});

	stdin.write('/');
	await wait();
	stdin.write('d');
	await wait();

	t.is(doneCalls, 0);
	t.regex(stripAnsi(lastFrame() || ''), /Search models: d/);
	unmount();
});

test('escape exits search first, then calls onBack', async t => {
	let backCalls = 0;
	const {stdin, lastFrame, unmount} = renderList({
		onBack: () => {
			backCalls += 1;
		},
	});

	stdin.write('/');
	await wait();
	stdin.write('model');
	await wait();
	stdin.write('\u001B');
	await wait();

	t.is(backCalls, 0);
	t.notRegex(lastFrame() || '', /Search models:/);

	stdin.write('\u001B');
	await wait();

	t.is(backCalls, 1);
	unmount();
});

test('renders error for empty selection', t => {
	const {lastFrame, unmount} = renderList({
		error: 'Please select at least one model',
	});

	t.regex(lastFrame() || '', /Please select at least one model/);
	unmount();
});

test('m triggers manual entry callback', async t => {
	let manualEntryCalls = 0;
	const {stdin, unmount} = renderList({
		onManualEntry: () => {
			manualEntryCalls += 1;
		},
	});

	stdin.write('m');
	await wait();

	t.is(manualEntryCalls, 1);
	unmount();
});

test('renders model name alongside id when available', t => {
	const models: FetchedModel[] = [
		{id: 'openai/gpt-4o', name: 'GPT-4o'},
		{id: 'ollama/llama3.1', name: 'ollama/llama3.1'},
	];
	const {lastFrame, unmount} = renderList({models});
	const output = lastFrame() || '';

	t.regex(output, /GPT-4o — openai\/gpt-4o/);
	t.regex(output, /ollama\/llama3\.1/);

	unmount();
});

test('truncates long model labels with an ellipsis', t => {
	const longId = `provider/${'x'.repeat(300)}`;
	const models: FetchedModel[] = [{id: longId, name: longId}];
	const {lastFrame, unmount} = renderList({models});
	const output = lastFrame() || '';

	t.regex(output, /…/);
	t.notRegex(output, new RegExp(longId.replace(/\//g, '\\/')));

	unmount();
});
