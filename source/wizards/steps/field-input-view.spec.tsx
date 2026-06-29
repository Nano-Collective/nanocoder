import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import stripAnsi from 'strip-ansi';
import type {TemplateField} from '../templates/provider-templates';
import {
	FieldInputView,
	type FieldInputViewProps,
} from './field-input-view';

const wait = async (ms = 30) =>
	new Promise(resolve => setTimeout(resolve, ms));

const colors = {primary: 'blue', secondary: 'gray', error: 'red'};

function renderField(
	overrides: Partial<FieldInputViewProps> & {currentField: TemplateField},
) {
	const submissions: Array<string | undefined> = [];
	const changes: string[] = [];

	const props: FieldInputViewProps = {
		templateName: 'OpenRouter',
		fieldIndex: 0,
		fieldCount: 5,
		currentValue: '',
		error: null,
		isNarrow: false,
		inputKey: 0,
		colors,
		onChange: v => changes.push(v),
		onSubmit: v => submissions.push(v),
		...overrides,
	};

	const utils = render(<FieldInputView {...props} />);
	return {...utils, submissions, changes};
}

test('boolean field renders Yes / No / Skip options', t => {
	const {lastFrame, unmount} = renderField({
		currentField: {
			name: 'allowFallbacks',
			prompt: 'Allow fallbacks?',
			type: 'boolean',
		},
	});

	const output = lastFrame() || '';
	t.regex(output, /Allow fallbacks\?/);
	t.regex(output, /Yes/);
	t.regex(output, /No/);
	t.regex(output, /Skip \(use OpenRouter default\)/);
	unmount();
});

test('boolean field defaults highlight to Skip when value is empty', t => {
	const {lastFrame, unmount} = renderField({
		currentField: {
			name: 'allowFallbacks',
			prompt: 'Allow fallbacks?',
			type: 'boolean',
		},
		currentValue: '',
	});

	// ink-select-input renders the highlighted item with the indicator character.
	// Check that the indicator is on the Skip line — i.e. the Skip line is
	// the rightmost "❯" line in the frame.
	const output = lastFrame() || '';
	const lines = output.split('\n');
	const skipLineIndex = lines.findIndex(l => l.includes('Skip'));
	t.true(skipLineIndex >= 0, 'Skip option should be rendered');
	t.regex(lines[skipLineIndex] ?? '', /❯/);
	unmount();
});

test('boolean field highlights Yes when currentValue is "true"', t => {
	const {lastFrame, unmount} = renderField({
		currentField: {
			name: 'allowFallbacks',
			prompt: 'Allow fallbacks?',
			type: 'boolean',
		},
		currentValue: 'true',
	});

	const output = lastFrame() || '';
	const lines = output.split('\n');
	const yesLineIndex = lines.findIndex(
		l => l.includes('Yes') && !l.includes('No'),
	);
	t.true(yesLineIndex >= 0, 'Yes option should be rendered');
	t.regex(lines[yesLineIndex] ?? '', /❯/);
	unmount();
});

test('boolean field highlights No when currentValue is "false"', t => {
	const {lastFrame, unmount} = renderField({
		currentField: {
			name: 'allowFallbacks',
			prompt: 'Allow fallbacks?',
			type: 'boolean',
		},
		currentValue: 'false',
	});

	// Strip ANSI: color codes end in `m`, which would defeat the \bNo\b word
	// boundary when CI forces color and renders the highlighted option in color.
	const output = stripAnsi(lastFrame() || '');
	const lines = output.split('\n');
	const noLineIndex = lines.findIndex(
		l => /\bNo\b/.test(l) && !l.includes('Yes'),
	);
	t.true(noLineIndex >= 0, 'No option should be rendered');
	t.regex(lines[noLineIndex] ?? '', /❯/);
	unmount();
});

test('boolean field submits chosen value synchronously on Enter', async t => {
	const {stdin, submissions, unmount} = renderField({
		currentField: {
			name: 'allowFallbacks',
			prompt: 'Allow fallbacks?',
			type: 'boolean',
		},
		currentValue: '',
	});

	// Default highlight is Skip — press Enter to submit empty string.
	stdin.write('\r');
	await wait();
	t.deepEqual(submissions, ['']);

	unmount();
});

test('boolean field submits "true" when Yes is chosen', async t => {
	const {stdin, submissions, unmount} = renderField({
		currentField: {
			name: 'allowFallbacks',
			prompt: 'Allow fallbacks?',
			type: 'boolean',
		},
		currentValue: 'true', // pre-highlight Yes
	});

	stdin.write('\r');
	await wait();
	t.deepEqual(submissions, ['true']);

	unmount();
});

test('boolean field submits "false" when No is chosen', async t => {
	const {stdin, submissions, unmount} = renderField({
		currentField: {
			name: 'allowFallbacks',
			prompt: 'Allow fallbacks?',
			type: 'boolean',
		},
		currentValue: 'false',
	});

	stdin.write('\r');
	await wait();
	t.deepEqual(submissions, ['false']);

	unmount();
});

test('boolean field does not render a TextInput box', t => {
	const {lastFrame, unmount} = renderField({
		currentField: {
			name: 'allowFallbacks',
			prompt: 'Allow fallbacks?',
			type: 'boolean',
		},
	});
	// The round-bordered input frame uses ╭…╯ characters. Booleans don't
	// render one because they use a SelectInput instead.
	const output = lastFrame() || '';
	t.notRegex(output, /╭/);
	unmount();
});

test('array field renders a TextInput (uses string widget path)', t => {
	const {lastFrame, unmount} = renderField({
		currentField: {
			name: 'providerOrder',
			prompt: 'Provider order (comma-separated)',
			type: 'array',
		},
		currentValue: 'Anthropic, OpenAI',
	});

	const output = lastFrame() || '';
	t.regex(output, /Provider order \(comma-separated\)/);
	t.regex(output, /Anthropic, OpenAI/);
	// TextInput path uses the bordered box.
	t.regex(output, /╭/);
	unmount();
});

test('string field (default) renders a TextInput', t => {
	const {lastFrame, unmount} = renderField({
		currentField: {
			name: 'apiKey',
			prompt: 'API key',
		},
		currentValue: 'sk-test',
	});

	const output = lastFrame() || '';
	t.regex(output, /API key/);
	t.regex(output, /sk-test/);
	t.regex(output, /╭/);
	unmount();
});

test('sensitive field masks the TextInput value', t => {
	const {lastFrame, unmount} = renderField({
		currentField: {
			name: 'apiKey',
			prompt: 'API key',
			sensitive: true,
		},
		currentValue: 'sk-secret-1234',
	});

	const output = lastFrame() || '';
	t.regex(output, /\*\*\*\*/);
	t.notRegex(output, /sk-secret-1234/);
	unmount();
});

test('renders error message when error is set', t => {
	const {lastFrame, unmount} = renderField({
		currentField: {
			name: 'apiKey',
			prompt: 'API key',
		},
		error: 'This field is required',
	});

	const output = lastFrame() || '';
	t.regex(output, /This field is required/);
	unmount();
});

test('renders field counter using fieldIndex + fieldCount', t => {
	const {lastFrame, unmount} = renderField({
		currentField: {
			name: 'sortBy',
			prompt: 'Sort by',
		},
		fieldIndex: 3,
		fieldCount: 9,
	});

	const output = lastFrame() || '';
	t.regex(output, /Field 4\/9/);
	unmount();
});

test('renders narrow keyboard hints when isNarrow is true', t => {
	const {lastFrame, unmount} = renderField({
		currentField: {
			name: 'apiKey',
			prompt: 'API key',
		},
		isNarrow: true,
	});

	const output = lastFrame() || '';
	t.regex(output, /Enter: continue/);
	t.regex(output, /Shift\+Tab: go back/);
	t.notRegex(output, /Press Enter to continue \|/);
	unmount();
});
