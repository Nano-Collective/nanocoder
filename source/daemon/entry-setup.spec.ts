import test from 'ava';
import type {LLMClient} from '@/types/core';
import {prepareDaemonSession} from './entry-setup';

test('daemon session sets the auto-commit client and loads plugins as trusted', async t => {
	const client = {} as LLMClient;
	const calls: string[] = [];
	let committedWith: LLMClient | null = null;
	await prepareDaemonSession(client, {
		setAutoCommitClient: value => {
			committedWith = value;
			calls.push('client');
		},
		loadPlugins: async trusted => {
			calls.push(`plugins:${trusted}`);
		},
	});
	t.is(committedWith, client);
	t.deepEqual(calls, ['client', 'plugins:true']);
});
