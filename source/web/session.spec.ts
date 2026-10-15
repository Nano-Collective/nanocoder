import test from 'ava';
import {prepareWebSession} from './session.js';

test('browser prompts do not access session storage when autosave is disabled', async t => {
	await t.notThrowsAsync(prepareWebSession('session', 'hello', {provider: 'local', model: 'small'}, false, {
		initialize: async () => {throw new Error('Storage unavailable');},
		readSession: async () => {throw new Error('Unexpected read');},
		createSession: async () => {throw new Error('Unexpected write');},
	}));
});
