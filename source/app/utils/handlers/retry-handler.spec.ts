import test from 'ava';
import type {MessageSubmissionOptions} from '@/types';
import {handleRetryCommand} from './retry-handler.js';

test('does not signal command completion after the retried turn returns', async t => {
	let chatCalls = 0;
	let completionCalls = 0;

	const options = {
		messages: [{role: 'user', content: 'retry me'}],
		provider: 'mock',
		onAddToChatQueue: () => {},
		onHandleChatMessage: async () => {
			chatCalls++;
		},
		onCommandComplete: () => {
			completionCalls++;
		},
	} as unknown as MessageSubmissionOptions;

	t.true(await handleRetryCommand(['retry'], options));
	t.is(chatCalls, 1);
	t.is(completionCalls, 0);
});
