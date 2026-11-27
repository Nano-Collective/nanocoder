import test from 'ava';
import {
	ARCHITECT_REVERT_NOTICE_PREFIX,
	BASH_OUTPUT_PREFIX,
	COMPACTION_RETRY_NOTICE,
} from '@/constants';
import {
	EMPTY_TURN_NUDGE,
	malformedToolCallNudge,
} from '@/hooks/chat-handler/utils/headless-retry-guards';
import type {CommandContext, Message} from '@/types/index';
import {appendTurnContext} from '@/utils/turn-context';
import {retryCommand} from './retry.js';

console.log('\nretry.spec.ts');

/** The slice of the dispatcher's context that `/retry` actually reads. */
function contextFor(messages: Message[]) {
	const submitted: {message: string; display: string}[] = [];
	const replacements: Parameters<CommandContext['submitChatMessage']>[2][] =
		[];
	const queued: unknown[] = [];
	const context = {
		argText: '',
		messages,
		provider: 'test',
		addToChatQueue: (element: unknown) => {
			queued.push(element);
		},
		submitChatMessage: async (
			message: string,
			display: string,
			replacement: (typeof replacements)[number],
		) => {
			submitted.push({message, display});
			replacements.push(replacement);
		},
	} as unknown as CommandContext;
	return {context, submitted, replacements, queued};
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

for (const [kind, approval] of [
	[
		'with an artifact',
		'The implementation plan below is approved. Proceed with implementing it now.\n\n<approved_plan>\nUpdate the parser.\n</approved_plan>',
	],
	[
		'without an artifact',
		'The plan above is approved. Proceed with implementing it now.',
	],
] as const) {
	test(`retry reruns the approved implementation ${kind}`, async t => {
		const {context, submitted, replacements} = contextFor([
			{role: 'user', content: 'Plan a parser update'},
			{role: 'assistant', content: 'Update the parser.'},
			{role: 'user', content: appendTurnContext(approval, ['Prior context'])},
			{role: 'assistant', content: 'Previous implementation attempt'},
		]);

		t.is(await retryCommand.run(context), 'handed-off');
		t.deepEqual(submitted, [{message: approval, display: approval}]);
		t.is(replacements[0]?.replaceFrom, 2);
	});
}

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

test('retry skips synthetic user-role messages and replaces the whole attempt', async t => {
	const {context, submitted, replacements} = contextFor([
		{role: 'user', content: 'Earlier request'},
		{role: 'assistant', content: 'Earlier answer'},
		{role: 'user', content: 'Run the tests'},
		{role: 'assistant', content: 'Previous attempt'},
		{role: 'tool', content: 'Previous tool result'},
		{role: 'user', content: `${BASH_OUTPUT_PREFIX}\n\`\`\`\n$ git status\nclean\n\`\`\``},
		{role: 'user', content: `${ARCHITECT_REVERT_NOTICE_PREFIX} Re-read any file before editing it - your earlier edits are gone.]`},
		{role: 'user', content: COMPACTION_RETRY_NOTICE},
		{role: 'user', content: 'Automatic diagnostics after the recent edits found issues.\nRecheck the edit.'},
		{role: 'user', content: malformedToolCallNudge('Missing path', 'Example')},
		{role: 'user', content: EMPTY_TURN_NUDGE, synthetic: true},
	]);

	t.is(await retryCommand.run(context), 'handed-off');
	t.deepEqual(submitted, [{message: 'Run the tests', display: 'Run the tests'}]);
	t.is(replacements[0]?.replaceFrom, 2);
});

test('retry accepts an actual user prompt with the generic nudge wording', async t => {
	const {context, submitted} = contextFor([
		{role: 'user', content: EMPTY_TURN_NUDGE},
		{role: 'assistant', content: 'Old response'},
	]);

	t.is(await retryCommand.run(context), 'handed-off');
	t.is(submitted[0]?.message, EMPTY_TURN_NUDGE);
});

test('retry preserves attachments on an image-only prompt', async t => {
	const images = [{data: 'aW1hZ2U=', mediaType: 'image/png'}];
	const {context, submitted, replacements} = contextFor([
		{role: 'user', content: appendTurnContext('', ['Project context']), images},
		{role: 'assistant', content: 'Previous attempt'},
	]);

	t.is(await retryCommand.run(context), 'handed-off');
	t.deepEqual(submitted, [{message: '', display: ''}]);
	t.deepEqual(replacements, [{images, replaceFrom: 0}]);
});

test('a failed model switch leaves the attempt alone', async t => {
	const {context, submitted} = contextFor([{role: 'user', content: 'Try this'}]);
	context.argText = '--model missing';
	context.switchModel = async () => false;

	t.is(await retryCommand.run(context), 'done');
	t.is(submitted.length, 0);
});
