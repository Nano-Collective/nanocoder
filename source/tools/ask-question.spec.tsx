import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {setGlobalQuestionHandler} from '../utils/question-queue';
import {askQuestionTool} from './ask-question';

console.log(`\nask-question.spec.tsx – ${React.version}`);

// ============================================================================
// Test Helpers
// ============================================================================

function TestThemeProvider({children}: {children: React.ReactNode}) {
	const themeContextValue = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{children}
		</ThemeContext.Provider>
	);
}

// ============================================================================
// Tests for Tool Configuration
// ============================================================================

test('ask_user tool has correct name', t => {
	t.is(askQuestionTool.name, 'ask_user');
});

test('ask_user tool does not require approval', t => {
	t.false(askQuestionTool.tool.needsApproval);
});

test('ask_user tool has execute function', t => {
	t.is(typeof askQuestionTool.tool.execute, 'function');
});

test('ask_user tool has formatter function', t => {
	t.is(typeof askQuestionTool.formatter, 'function');
});

// ============================================================================
// Tests for Tool Execution
// ============================================================================

test('ask_user execute returns error for fewer than 2 options', async t => {
	setGlobalQuestionHandler(async _q => 'should not be called');

	const result = await askQuestionTool.tool.execute!(
		{question: 'Pick one', options: ['Only one']},
		{toolCallId: 'test', messages: []},
	);

	t.regex(result, /Error.*2-4/);
});

test('ask_user execute returns error for more than 4 options', async t => {
	setGlobalQuestionHandler(async _q => 'should not be called');

	const result = await askQuestionTool.tool.execute!(
		{
			question: 'Pick one',
			options: ['A', 'B', 'C', 'D', 'E'],
		},
		{toolCallId: 'test', messages: []},
	);

	t.regex(result, /Error.*2-4/);
});

test('ask_user execute calls signalQuestion and returns answer', async t => {
	setGlobalQuestionHandler(async q => {
		t.is(q.question, 'Which database?');
		t.deepEqual(q.options, ['PostgreSQL', 'SQLite']);
		t.true(q.allowFreeform);
		return 'PostgreSQL';
	});

	const result = await askQuestionTool.tool.execute!(
		{
			question: 'Which database?',
			options: ['PostgreSQL', 'SQLite'],
		},
		{toolCallId: 'test', messages: []},
	);

	t.is(result, 'PostgreSQL');
});

test('ask_user execute respects allowFreeform=false', async t => {
	setGlobalQuestionHandler(async q => {
		t.false(q.allowFreeform);
		return 'Option A';
	});

	const result = await askQuestionTool.tool.execute!(
		{
			question: 'Pick',
			options: ['Option A', 'Option B'],
			allowFreeform: false,
		},
		{toolCallId: 'test', messages: []},
	);

	t.is(result, 'Option A');
});

test('ask_user execute defaults allowFreeform to true', async t => {
	setGlobalQuestionHandler(async q => {
		t.true(q.allowFreeform);
		return 'answer';
	});

	await askQuestionTool.tool.execute!(
		{
			question: 'Pick',
			options: ['A', 'B'],
		},
		{toolCallId: 'test', messages: []},
	);

	t.pass();
});

// ============================================================================
// Tests for Formatter
// ============================================================================

test('ask_user formatter renders question and answer', t => {
	const formatter = askQuestionTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{question: 'Which framework?', options: ['React', 'Vue']},
		'React',
	);
	const {lastFrame} = render(
		<TestThemeProvider>{element}</TestThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /ask_user/);
	t.regex(output!, /Which framework/);
	t.regex(output!, /React/);
});

test('ask_user formatter renders question without answer when result is undefined', t => {
	const formatter = askQuestionTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{question: 'Which framework?', options: ['React', 'Vue']},
		undefined,
	);
	const {lastFrame} = render(
		<TestThemeProvider>{element}</TestThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Which framework/);
});

test('ask_user formatter returns empty fragment for error results', t => {
	const formatter = askQuestionTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{question: 'Pick', options: ['A', 'B']},
		'Error: something broke',
	);
	const {lastFrame} = render(element);

	const output = lastFrame();
	t.is(output, '');
});
