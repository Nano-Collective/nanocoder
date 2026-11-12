import test from 'ava';
import {sharedProposalStore} from '@/memory/proposal-store';
import type {MemoryProposal} from '@/memory/summarizer-service';
import type {CommandContext} from '@/types/index';
import {clearCommand} from './clear';

function createContext(calls: string[]): CommandContext {
	return {
		args: [],
		messages: [],
		addToChatQueue: () => calls.push('queue'),
		clearMessages: async () => {
			calls.push('clear-messages');
		},
		notifyCleared: () => calls.push('notify-cleared'),
		renameSession: () => calls.push('rename'),
		showStatus: () => calls.push('status'),
	};
}

test('clearCommand has correct name and description', t => {
	t.is(clearCommand.name, 'clear');
	t.is(
		clearCommand.description,
		'Clear the chat history, model context, and tasks',
	);
});

test.serial('clearCommand clears the conversation, then tells the app', async t => {
	const calls: string[] = [];
	sharedProposalStore.set([{content: 'x'} as unknown as MemoryProposal]);

	const completion = await clearCommand.run(createContext(calls));

	t.deepEqual(calls, ['clear-messages', 'notify-cleared']);
	t.is(sharedProposalStore.size, 0, 'memory proposals are dropped');
	t.is(completion, 'done-after-render');
});
