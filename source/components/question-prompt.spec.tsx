import test from 'ava';
import React, {useEffect, useState} from 'react';
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
	t.regex(output!, /Type a custom answer/);
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
	t.notRegex(output!, /Type a custom answer/);
	unmount();
});

test('QuestionPrompt shows navigation and cancel hints', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<QuestionPrompt question={createQuestion()} onAnswer={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Enter to select/);
	t.regex(output!, /Esc to cancel/);
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

// Regression: when two ask_user calls fire back-to-back the parent batches
// pendingQuestion null → new, so QuestionPrompt re-renders with new props
// instead of unmounting. Internal state (answeredRef, freeform mode/value,
// SelectInput selected index) must reset so the second question is usable.
test('QuestionPrompt accepts a new answer when question prop changes without unmount', async t => {
	const answers: string[] = [];
	const q1 = createQuestion({
		question: 'First question',
		options: ['A1', 'B1'],
		allowFreeform: false,
	});
	const q2 = createQuestion({
		question: 'Second question',
		options: ['A2', 'B2'],
		allowFreeform: false,
	});

	let swapToQ2: () => void = () => {};
	function Harness() {
		const [q, setQ] = useState<PendingQuestion>(q1);
		useEffect(() => {
			swapToQ2 = () => setQ(q2);
		}, []);
		return <QuestionPrompt question={q} onAnswer={a => answers.push(a)} />;
	}

	const {stdin, lastFrame, unmount} = renderWithTheme(<Harness />);
	const tick = () => new Promise(resolve => setTimeout(resolve, 20));

	// Pick the first option for Q1 (Enter on the default selection).
	stdin.write('\r');
	await tick();
	t.deepEqual(answers, ['A1']);

	// Parent now hands us Q2 without unmounting (the batched-update case).
	swapToQ2();
	await tick();

	const frame = lastFrame();
	t.regex(frame!, /Second question/);
	t.regex(frame!, /A2/);
	t.regex(frame!, /B2/);

	// Submitting the default selection must produce Q2's answer — not be
	// silently dropped by a stale answeredRef.
	stdin.write('\r');
	await tick();
	t.deepEqual(answers, ['A1', 'A2']);

	unmount();
});
