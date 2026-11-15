import test from 'ava';
import cliTruncate from 'cli-truncate';
import {render} from 'ink-testing-library';
import React from 'react';
import stringWidth from 'string-width';
import type {QueuedUserMessage} from '../../hooks/useUserMessageQueue';
import {formatQueuedRow} from './queued-message-list.js';
import {useQueuedMessageSelection} from './useQueuedMessageSelection.js';

type Queue = ReturnType<typeof useQueuedMessageSelection>;

const msg = (id: string, displayValue = `message ${id}`): QueuedUserMessage =>
	({id, message: displayValue, displayValue}) as QueuedUserMessage;

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

function setup(initial: {messages: QueuedUserMessage[]; input?: string}) {
	const loaded: string[] = [];
	const removed: string[] = [];
	let queue!: Queue;
	let props = {messages: initial.messages, input: initial.input ?? ''};
	const onLoadForEditing = (m: QueuedUserMessage) => {
		loaded.push(m.id);
	};
	const onRemoveQueuedMessage = (id: string) => {
		removed.push(id);
	};
	function Probe({
		messages,
		input,
	}: {
		messages: QueuedUserMessage[];
		input: string;
	}) {
		queue = useQueuedMessageSelection({
			queuedMessages: messages,
			input,
			onRemoveQueuedMessage,
			onLoadForEditing,
		});
		return null;
	}
	const view = render(<Probe {...props} />);
	return {
		loaded,
		removed,
		get queue() {
			return queue;
		},
		async act<T>(fn: (q: Queue) => T): Promise<T> {
			const result = fn(queue);
			await settle();
			return result;
		},
		async update(next: Partial<typeof props>) {
			props = {...props, ...next};
			view.rerender(<Probe {...props} />);
			await settle();
		},
		unmount: view.unmount,
	};
}

test('↓ walks into the queue and stops at the last item; ↑ walks back to the prompt', async t => {
	const s = setup({messages: [msg('a'), msg('b')]});
	t.teardown(s.unmount);

	t.is(s.queue.selectedIndex, -1);
	t.false(await s.act(q => q.navigate('up')), 'from the prompt ↑ is history');
	t.true(await s.act(q => q.navigate('down')));
	t.is(s.queue.selectedIndex, 0);
	t.true(await s.act(q => q.navigate('down')));
	t.is(s.queue.selectedIndex, 1);
	t.true(await s.act(q => q.navigate('down')), 'no wrap at the last item');
	t.is(s.queue.selectedIndex, 1);
	await s.act(q => q.navigate('up'));
	await s.act(q => q.navigate('up'));
	t.is(s.queue.selectedIndex, -1);
});

test('the queue is not navigable while the prompt has text or the queue is empty', async t => {
	const s = setup({messages: [msg('a')], input: 'typing'});
	t.teardown(s.unmount);
	t.false(await s.act(q => q.navigate('down')));

	await s.update({input: '', messages: []});
	t.false(await s.act(q => q.navigate('down')));
});

test('Enter loads the selected message for editing, then removes it from the queue', async t => {
	const s = setup({messages: [msg('a'), msg('b')]});
	t.teardown(s.unmount);

	t.false(await s.act(q => q.loadSelected()), 'nothing selected');
	await s.act(q => q.navigate('down'));
	await s.act(q => q.navigate('down'));
	t.true(await s.act(q => q.loadSelected()));
	t.deepEqual(s.loaded, ['b']);
	t.deepEqual(s.removed, ['b']);
	t.is(s.queue.selectedIndex, -1);
});

test('Delete removes the selected message and keeps a neighbour selected', async t => {
	const s = setup({messages: [msg('a'), msg('b'), msg('c')]});
	t.teardown(s.unmount);

	t.false(await s.act(q => q.removeSelected()), 'plain backspace falls through');
	for (let i = 0; i < 3; i++) await s.act(q => q.navigate('down'));
	t.true(await s.act(q => q.removeSelected()));
	t.deepEqual(s.removed, ['c']);
	t.is(s.queue.selectedIndex, 1, 'removing the last item selects the one above');
});

test('the selection is clamped when the queue shrinks, and cleared when it empties', async t => {
	const s = setup({messages: [msg('a'), msg('b'), msg('c')]});
	t.teardown(s.unmount);
	for (let i = 0; i < 3; i++) await s.act(q => q.navigate('down'));
	t.is(s.queue.selectedIndex, 2);

	await s.update({messages: [msg('a')]});
	t.is(s.queue.selectedIndex, 0);
	await s.update({messages: []});
	t.is(s.queue.selectedIndex, -1);
});

test('resetSelection returns to the prompt', async t => {
	const s = setup({messages: [msg('a')]});
	t.teardown(s.unmount);
	await s.act(q => q.navigate('down'));
	await s.act(q => q.resetSelection());
	t.is(s.queue.selectedIndex, -1);
});

const truncate = (text: string, maxLength: number) =>
	cliTruncate(text, maxLength);

test('formatQueuedRow collapses whitespace and adds an image count', t => {
	const message = {
		...msg('a', 'line one\n\n  line two'),
		images: [
			{data: 'x', mediaType: 'image/png'},
			{data: 'y', mediaType: 'image/png'},
		],
	} as QueuedUserMessage;
	t.is(formatQueuedRow(message, 80, truncate), 'line one line two (2 images)');
	t.is(
		formatQueuedRow({...message, images: [message.images![0]!]}, 80, truncate),
		'line one line two (1 image)',
	);
});

test('formatQueuedRow fits a long or double-width message inside the prompt box', t => {
	const promptWidth = 40;
	// Border (2) + padding (2) + selection marker (2) leave 34 columns.
	for (const text of ['x'.repeat(200), '漢字'.repeat(60)]) {
		const row = formatQueuedRow(msg('a', text), promptWidth, truncate);
		t.true(stringWidth(row) <= promptWidth - 6, `${stringWidth(row)} cols`);
	}
});
