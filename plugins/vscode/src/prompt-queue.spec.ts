import test from 'ava';
import {PromptQueue, type QueuedPrompt} from './prompt-queue';

function prompt(id: string, text = id): QueuedPrompt {
	return {id, text};
}

test('PromptQueue - submit when idle starts immediately', t => {
	const queue = new PromptQueue();

	t.is(
		queue.submit(prompt('msg-1', 'first')),
		'started',
		'An idle composer should send the first prompt, not park it behind a phantom turn',
	);
	t.true(queue.turnActive);
	t.deepEqual(
		queue.ids,
		[],
		'A started prompt is in flight, not waiting — a Queued badge on it would be a lie',
	);
});

test('PromptQueue - submit while a turn is active queues in FIFO order', t => {
	const queue = new PromptQueue();
	queue.submit(prompt('msg-1', 'running'));

	t.is(
		queue.submit(prompt('msg-2', 'also update the README')),
		'queued',
		'A follow-up typed mid-turn must not fire a second ACP prompt (the agent throws "already in progress")',
	);
	t.is(queue.submit(prompt('msg-3', 'and the changelog')), 'queued');
	t.deepEqual(queue.ids, ['msg-2', 'msg-3']);
	t.true(queue.turnActive);
});

test('PromptQueue - completeAndDequeue pops one and keeps the turn active', t => {
	const queue = new PromptQueue();
	queue.submit(prompt('msg-1'));
	queue.submit(prompt('msg-2', 'second'));
	queue.submit(prompt('msg-3', 'third'));

	const next = queue.completeAndDequeue();
	t.truthy(next);
	t.is(next?.id, 'msg-2');
	t.is(next?.text, 'second');
	t.true(
		queue.turnActive,
		'Draining into the next prompt must keep the mutex held or a concurrent Enter would start a third overlapping turn',
	);
	t.deepEqual(queue.ids, ['msg-3']);

	t.is(queue.completeAndDequeue()?.id, 'msg-3');
	t.true(queue.turnActive);
	t.deepEqual(queue.ids, []);

	t.is(
		queue.completeAndDequeue(),
		null,
		'An empty queue after the last drain is how the Send button comes back',
	);
	t.false(queue.turnActive);
});

test('PromptQueue - completeAndDequeue on a started prompt with nothing waiting', t => {
	const queue = new PromptQueue();
	queue.submit(prompt('msg-1'));

	t.is(queue.completeAndDequeue(), null);
	t.false(queue.turnActive);
});

test('PromptQueue - remove of a waiting id is a no-op for unknown ids', t => {
	const queue = new PromptQueue();
	queue.submit(prompt('msg-1'));
	queue.submit(prompt('msg-2'));
	queue.submit(prompt('msg-3'));

	t.false(
		queue.remove('msg-1'),
		'The in-flight prompt is not in the waiting list — Stop cancels it, the X on a Queued badge does not',
	);
	t.false(queue.remove('does-not-exist'));
	t.true(queue.remove('msg-2'));
	t.deepEqual(queue.ids, ['msg-3']);
	t.true(queue.turnActive);
});

test('PromptQueue - clear discards the waiting list and resets turn state', t => {
	const queue = new PromptQueue();
	queue.submit(prompt('msg-1'));
	queue.submit(prompt('msg-2'));
	queue.submit(prompt('msg-3'));

	t.deepEqual(
		queue.clear(),
		['msg-2', 'msg-3'],
		'Stop / Escape must report every waiting id so the webview can strip those bubbles',
	);
	t.deepEqual(queue.ids, []);
	t.true(
		queue.turnActive,
		'The cancelled turn is still unwinding — releasing the mutex here would let a new Enter overlap its finally/drain',
	);

	t.is(
		queue.submit(prompt('msg-4')),
		'queued',
		'A prompt typed during abort waits; completeAndDequeue starts it once ACP cancel settles',
	);

	t.is(queue.completeAndDequeue()?.id, 'msg-4');
	t.true(queue.turnActive);

	t.is(queue.completeAndDequeue(), null);
	t.false(queue.turnActive);
	t.is(
		queue.submit(prompt('msg-5')),
		'started',
		'After the cancelled turn drains, the next prompt is a fresh turn',
	);
});
