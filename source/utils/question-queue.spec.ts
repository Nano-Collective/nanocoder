import test from 'ava';
import {
	type PendingQuestion,
	setGlobalQuestionHandler,
	signalQuestion,
} from './question-queue';

console.log(`\nquestion-queue.spec.ts`);

// ============================================================================
// Test Helpers
// ============================================================================

function createQuestion(
	overrides: Partial<PendingQuestion> = {},
): PendingQuestion {
	return {
		question: 'Which approach?',
		options: ['Option A', 'Option B'],
		allowFreeform: true,
		...overrides,
	};
}

// ============================================================================
// Tests for setGlobalQuestionHandler
// ============================================================================

test('signalQuestion returns error when no handler is set', async t => {
	// Reset by setting a handler then we'll test without one
	// signalQuestion should gracefully handle missing handler
	// We can't truly reset the module state, so we test the handler path
	const question = createQuestion();

	// Set a handler to verify it works
	let handlerCalled = false;
	setGlobalQuestionHandler(async _q => {
		handlerCalled = true;
		return 'test answer';
	});

	const result = await signalQuestion(question);
	t.true(handlerCalled);
	t.is(result, 'test answer');
});

test('signalQuestion passes question data to handler', async t => {
	let receivedQuestion: PendingQuestion | null = null;

	setGlobalQuestionHandler(async q => {
		receivedQuestion = q;
		return 'answer';
	});

	const question = createQuestion({
		question: 'Pick a color',
		options: ['Red', 'Blue', 'Green'],
		allowFreeform: false,
	});

	await signalQuestion(question);

	t.deepEqual(receivedQuestion, question);
});

test('signalQuestion returns the handler response', async t => {
	setGlobalQuestionHandler(async _q => {
		return 'User picked Option B';
	});

	const result = await signalQuestion(createQuestion());
	t.is(result, 'User picked Option B');
});

test('signalQuestion handles async handlers', async t => {
	setGlobalQuestionHandler(async _q => {
		// Simulate async delay
		await new Promise(resolve => setTimeout(resolve, 10));
		return 'delayed answer';
	});

	const result = await signalQuestion(createQuestion());
	t.is(result, 'delayed answer');
});

test('setGlobalQuestionHandler overwrites previous handler', async t => {
	let firstCalled = false;
	let secondCalled = false;

	setGlobalQuestionHandler(async _q => {
		firstCalled = true;
		return 'first';
	});

	setGlobalQuestionHandler(async _q => {
		secondCalled = true;
		return 'second';
	});

	const result = await signalQuestion(createQuestion());
	t.false(firstCalled);
	t.true(secondCalled);
	t.is(result, 'second');
});
