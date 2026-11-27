import test from 'ava';
import {
	autoCompactSessionOverrides,
	resetAutoCompactSession,
} from '@/conversation/compaction/auto-compact-session';
import type {CommandContext, Message} from '@/types/index';
import {compactCommand} from './compact.js';

console.log('\ncompact.spec.ts');

function history(): Message[] {
	const messages: Message[] = [];
	for (let i = 0; i < 8; i++) {
		messages.push({role: 'user', content: `question ${i} `.repeat(40)});
		messages.push({role: 'assistant', content: `answer ${i} `.repeat(40)});
	}
	return messages;
}

/** The slice of the dispatcher's context that `/compact` reads. */
function contextFor(argText: string) {
	const queued: unknown[] = [];
	let setMessagesCalls = 0;
	const context = {
		argText,
		messages: history(),
		setMessages: () => {
			setMessagesCalls++;
		},
		addToChatQueue: (element: unknown) => {
			queued.push(element);
		},
		provider: 'test',
		model: 'test-model',
		client: null,
		setIsToolExecuting: () => {},
	} as unknown as CommandContext;
	return {context, queued, setMessagesCalls: () => setMessagesCalls};
}

test.afterEach(() => {
	resetAutoCompactSession();
});

// #2427: each of these used to fall through to a real compaction.
for (const argText of [
	'--previw',
	'--dry-run',
	'help',
	'--threshold',
	'--strategy',
	'--mechanical --previw',
]) {
	test(`compact leaves the history alone and reports "${argText}"`, async t => {
		const {context, queued, setMessagesCalls} = contextFor(argText);
		t.is(await compactCommand.run(context), 'done-after-render');
		t.is(setMessagesCalls(), 0);
		t.is(queued.length, 1);
	});
}

test('compact --mechanical --preview still previews without changing the history', async t => {
	const {context, setMessagesCalls} = contextFor('--mechanical --preview');
	await compactCommand.run(context);
	t.is(setMessagesCalls(), 0);
});

test('compact --threshold <n> and --strategy <s> still set the session values', async t => {
	t.is(await compactCommand.run(contextFor('--threshold 80').context), 'done-after-render');
	t.is(
		await compactCommand.run(contextFor('--strategy mechanical').context),
		'done-after-render',
	);
	t.is(autoCompactSessionOverrides.threshold, 80);
	t.is(autoCompactSessionOverrides.strategy, 'mechanical');
});
