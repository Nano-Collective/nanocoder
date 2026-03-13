import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme';
import type {PendingQuestion} from '../utils/question-queue';
import QuestionPrompt from './question-prompt';

console.log(`\nquestion-prompt.spec.tsx – ${React.version}`);

// ============================================================================
// Test Helpers
// ============================================================================

function createQuestion(
	overrides: Partial<PendingQuestion> = {},
): PendingQuestion {
	return {
		question: 'Which approach do you prefer?',
		options: ['Option A', 'Option B'],
		allowFreeform: true,
		...overrides,
	};
}

// ============================================================================
// Tests for Rendering
// ============================================================================

test('QuestionPrompt renders without error', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<QuestionPrompt question={createQuestion()} onAnswer={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('QuestionPrompt displays the question text', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<QuestionPrompt
			question={createQuestion({question: 'Pick a database'})}
			onAnswer={() => {}}
		/>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Pick a database/);
	unmount();
});

test('QuestionPrompt displays all options', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<QuestionPrompt
			question={createQuestion({
				options: ['PostgreSQL', 'SQLite', 'MongoDB'],
			})}
			onAnswer={() => {}}
		/>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /PostgreSQL/);
	t.regex(output!, /SQLite/);
	t.regex(output!, /MongoDB/);
	unmount();
});

test('QuestionPrompt shows freeform option when allowFreeform is true', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<QuestionPrompt
			question={createQuestion({allowFreeform: true})}
			onAnswer={() => {}}
		/>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Type custom answer/);
	unmount();
});

test('QuestionPrompt hides freeform option when allowFreeform is false', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<QuestionPrompt
			question={createQuestion({allowFreeform: false})}
			onAnswer={() => {}}
		/>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Type custom answer/);
	unmount();
});

test('QuestionPrompt shows escape hint', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<QuestionPrompt question={createQuestion()} onAnswer={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Escape/);
	unmount();
});

test('QuestionPrompt renders with 4 options', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<QuestionPrompt
			question={createQuestion({
				options: ['A', 'B', 'C', 'D'],
				allowFreeform: false,
			})}
			onAnswer={() => {}}
		/>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /A/);
	t.regex(output!, /D/);
	unmount();
});

test('QuestionPrompt renders with 2 options (minimum)', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<QuestionPrompt
			question={createQuestion({
				options: ['Yes', 'No'],
				allowFreeform: false,
			})}
			onAnswer={() => {}}
		/>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Yes/);
	t.regex(output!, /No/);
	unmount();
});
