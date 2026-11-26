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

/** contextFor() with argText and a model switch that records its calls. */
function retryWith(argText: string) {
	const setup = contextFor([
		{role: 'user', content: 'refactor the auth module'},
		{role: 'assistant', content: 'Done.'},
	]);
	const switches: {provider: string; model: string}[] = [];
	Object.assign(setup.context, {
		argText,
		switchModel: async (provider: string, model: string) => {
			switches.push({provider, model});
			return true;
		},
	});
	return {...setup, switches};
}

test('retry switches model with --model <id> and --model=<id>', async t => {
	for (const argText of ['--model other-model', '--model=other-model']) {
		const {context, submitted, switches} = retryWith(argText);
		t.is(await retryCommand.run(context), 'handed-off', argText);
		t.deepEqual(switches, [{provider: 'test', model: 'other-model'}], argText);
		t.is(submitted.length, 1, argText);
	}
});

test('retry switches provider and model with --provider=<name> --model=<id>', async t => {
	const {context, switches} = retryWith('--provider=openrouter --model=m1');
	t.is(await retryCommand.run(context), 'handed-off');
	t.deepEqual(switches, [{provider: 'openrouter', model: 'm1'}]);
});

test('retry keeps a quoted model name with spaces as one value', async t => {
	const {context, switches} = retryWith('--model "my local model"');
	t.is(await retryCommand.run(context), 'handed-off');
	t.deepEqual(switches, [{provider: 'test', model: 'my local model'}]);
});

for (const argText of [
	'--modle other-model',
	'--model',
	'--model=',
	'--model --provider openrouter',
	'--provider openrouter',
	'--model other-model extra',
	'other-model',
]) {
	test(`retry shows the usage and re-sends nothing for "${argText}"`, async t => {
		const {context, submitted, queued, switches} = retryWith(argText);
		t.is(await retryCommand.run(context), 'done');
		t.is(submitted.length, 0);
		t.deepEqual(switches, []);
		t.is(queued.length, 1);
	});
}
