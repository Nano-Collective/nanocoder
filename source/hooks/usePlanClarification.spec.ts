import test from 'ava';
import type {PendingQuestion} from '../utils/question-queue';
import {setGlobalQuestionHandler} from '../utils/question-queue';
import {
	formatClarificationContext,
	runClarification,
} from './usePlanClarification';

console.log('\nusePlanClarification.spec.ts');

// ============================================================================
// formatClarificationContext
// ============================================================================

test('formatClarificationContext returns empty string for no questions', t => {
	const result = formatClarificationContext({answers: {}, asked: []});
	t.is(result, '');
});

test('formatClarificationContext formats answered questions', t => {
	const result = formatClarificationContext({
		asked: [
			{
				id: 'auth-method',
				type: 'decision',
				question: 'What authentication approach?',
				options: ['JWT tokens', 'Session-based'],
			},
		],
		answers: {'auth-method': 'JWT tokens'},
	});
	t.true(result.includes('Pre-plan clarifications'));
	t.true(result.includes('What authentication approach?'));
	t.true(result.includes('JWT tokens'));
});

// ============================================================================
// runClarification — mode gating
// ============================================================================

test('runClarification returns empty for non-plan modes', async t => {
	for (const mode of ['normal', 'auto-accept', 'yolo', 'headless'] as const) {
		const result = await runClarification('add authentication', mode);
		t.deepEqual(result.answers, {});
		t.deepEqual(result.asked, []);
	}
});

test('runClarification returns empty for unambiguous messages in plan mode', async t => {
	const result = await runClarification(
		'read the README and summarize it',
		'plan',
	);
	t.deepEqual(result.answers, {});
	t.deepEqual(result.asked, []);
});

// ============================================================================
// runClarification — question presentation
// ============================================================================

test('runClarification presents questions via signalQuestion in plan mode', async t => {
	setGlobalQuestionHandler(async (q: PendingQuestion) => {
		// Simulate user picking the first option
		return q.options[0] ?? 'Option A';
	});

	const result = await runClarification('add user authentication', 'plan');

	t.true(result.asked.length > 0);
	t.true(Object.keys(result.answers).length > 0);
});

test('runClarification skips question when user declines', async t => {
	setGlobalQuestionHandler(async (_q: PendingQuestion) => 'User declined to answer');

	const result = await runClarification('add user authentication', 'plan');

	// All declined → empty answers, empty asked
	t.deepEqual(result.answers, {});
	t.deepEqual(result.asked, []);
});

test('runClarification collects answers for multiple questions', async t => {
	let callCount = 0;
	setGlobalQuestionHandler(async (q: PendingQuestion) => {
		callCount++;
		return q.options[0] ?? 'answer';
	});

	// This message triggers auth + api-style at minimum
	const result = await runClarification(
		'build a REST api with user authentication and a database',
		'plan',
	);

	t.true(callCount > 0);
	t.true(result.asked.length <= 3); // never more than 3
});

test('runClarification forwards questionType to signalQuestion', async t => {
	let receivedType: string | undefined;
	setGlobalQuestionHandler(async (q: PendingQuestion) => {
		receivedType = q.questionType;
		return q.options[0] ?? 'answer';
	});

	await runClarification('add user authentication', 'plan');

	t.truthy(receivedType);
	t.true(['ambiguity', 'decision', 'confirmation'].includes(receivedType!));
});
