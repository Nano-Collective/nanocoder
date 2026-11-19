import test from 'ava';
import {displayError} from '@/hooks/chat-handler/utils/message-helpers';
import {getRunFailure, markRunFailed, resetRunFailure} from './run-outcome';

test.beforeEach(() => {
	resetRunFailure();
});

test.serial('the first recorded failure wins', t => {
	t.is(getRunFailure(), null);
	markRunFailed('first');
	markRunFailed('second');
	t.is(getRunFailure(), 'first');
});

test.serial('a displayed chat error marks the run failed', t => {
	displayError(new Error('Connection failed'), 'chat-error', () => {});
	t.truthy(getRunFailure());
});

test.serial('a user cancellation does not mark the run failed', t => {
	displayError(new Error('Operation was cancelled'), 'chat-error', () => {});
	t.is(getRunFailure(), null);
});
