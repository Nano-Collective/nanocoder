import test from 'ava';
import type {CommandContext, Message} from '@/types/index';
import {appendTurnContext} from '@/utils/turn-context';
import {retryCommand} from './retry.js';

console.log('\nretry.spec.ts');

/** The slice of the dispatcher's context that `/retry` actually reads. */
function contextFor(messages: Message[]) {
	const submitted: {message: string; display: string}[] = [];
	const queued: unknown[] = [];
	const context = {
		argText: '',
		messages,
		provider: 'test',
		addToChatQueue: (element: unknown) => {
			queued.push(element);
		},
		submitChatMessage: async (message: string, display: string) => {
			submitted.push({message, display});
		},
	} as unknown as CommandContext;
	return {context, submitted, queued};
}

test('retry resubmits the last user message', async t => {
	const {context, submitted} = contextFor([
		{role: 'user', content: 'refactor the auth module'},
		{role: 'assistant', content: 'Done.'},
	]);

	t.is(await retryCommand.run(context), 'handed-off');
	t.deepEqual(submitted, [
		{message: 'refactor the auth module', display: 'refactor the auth module'},
	]);
});

// The stored message carries the block that was built for it (#1574).
// Resubmitting it raw would wrap one block inside another and, worse, hand
// `findRelevantCommands` and the memory search a query containing the previous
// turn's own recalled context — so the retry would not be a retry of the same
// request.
test('retry strips the stored per-turn context block before resubmitting', async t => {
	const stored = appendTurnContext('refactor the auth module', [
		'## Project Context\n\n- Auth uses Clerk.',
		'## Available Skills\n\n### changelog\n\nSummarise the change.',
	]);
	const {context, submitted} = contextFor([
		{role: 'user', content: stored},
		{role: 'assistant', content: 'Done.'},
	]);

	t.is(await retryCommand.run(context), 'handed-off');
	t.is(submitted.length, 1);
	// Byte-identical to what the user typed, on both the model and display
	// arguments: the display one is the chat bubble.
	t.is(submitted[0]?.message, 'refactor the auth module');
	t.is(submitted[0]?.display, 'refactor the auth module');
});

test('retry reports when there is no user message yet', async t => {
	const {context, submitted, queued} = contextFor([
		{role: 'assistant', content: 'Hello.'},
	]);

	t.is(await retryCommand.run(context), 'done');
	t.is(submitted.length, 0);
	t.is(queued.length, 1);
});
