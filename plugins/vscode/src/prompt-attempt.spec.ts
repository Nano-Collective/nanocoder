import test from 'ava';
import {PromptAttempt} from './prompt-attempt';

test('PromptAttempt - records an expected cancellation', t => {
	const attempt = new PromptAttempt();

	t.false(attempt.cancelRequested);
	attempt.cancel();
	t.true(attempt.cancelRequested);
});
