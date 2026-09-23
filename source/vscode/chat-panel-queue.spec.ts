import test from 'ava';
import {createPanel} from '@/vscode/chat-panel-harness';

function startTurn(panel: ReturnType<typeof createPanel>, id = 'msg-1') {
	panel.post({type: 'promptStarted', id});
}

function submitMessages(panel: ReturnType<typeof createPanel>) {
	return panel.sent.filter(
		(message: {type?: string}) => message.type === 'submitMessage',
	);
}

test('Send stays Stop while a turn is running and the composer is empty', t => {
	const panel = createPanel();
	const button = panel.el('send-stop-btn');

	startTurn(panel);

	t.true(
		button.classList.contains('is-processing'),
		'An empty composer mid-turn must keep Stop — that is how you cancel',
	);
	t.is(button.title, 'Stop (cancel)');
	t.false(
		panel.el('queue-hint').classList.contains('hidden'),
		'A visible hint is how the user learns Enter queues instead of waiting for Stop to become Send',
	);
});

test('typing a follow-up mid-turn flips Stop back to Send so the click queues', t => {
	const panel = createPanel();
	const input = panel.el('chat-input');
	const button = panel.el('send-stop-btn');

	startTurn(panel);
	input.value = 'also update the README';
	input.dispatchEvent({type: 'input'});

	t.false(
		button.classList.contains('is-processing'),
		'A typed follow-up must not leave the button as Stop — clicking Stop would cancel instead of queue',
	);
	t.is(button.title, 'Queue (Enter)');
});

test('clicking the button with a follow-up typed mid-turn parks it instead of cancelling or overlapping ACP', t => {
	const panel = createPanel();
	const input = panel.el('chat-input');

	startTurn(panel);
	input.value = 'and the changelog';
	panel.el('send-stop-btn').click();

	t.is(
		submitMessages(panel).length,
		0,
		'A follow-up must not be posted while a turn is in flight — that is the RequestError: Internal error',
	);
	t.is(
		panel.sent.filter((message: {type?: string}) => message.type === 'cancel')
			.length,
		0,
		'Clicking Send with text in the composer must not abort the in-flight turn',
	);
	t.truthy(
		panel.container.querySelector('.queued-badge'),
		'The follow-up should appear as a Queued bubble until the current turn ends',
	);
});

test('clicking the button with an empty composer mid-turn still cancels', t => {
	const panel = createPanel();

	startTurn(panel);
	panel.el('send-stop-btn').click();

	t.deepEqual(
		panel.sent
			.map((message: {type?: string}) => message.type)
			.filter(type => type !== 'ready'),
		['cancel'],
	);
});

test('Enter mid-turn parks the follow-up locally instead of posting it', t => {
	const panel = createPanel();
	const input = panel.el('chat-input');

	startTurn(panel);
	input.value = 'queued from enter';
	input.dispatchEvent({
		type: 'keydown',
		key: 'Enter',
		shiftKey: false,
		preventDefault() {},
		stopPropagation() {},
	});

	t.is(submitMessages(panel).length, 0);
	t.truthy(panel.container.querySelector('.queued-badge'));
});

test('a parked follow-up is sent once the in-flight turn finishes', t => {
	const panel = createPanel();
	const input = panel.el('chat-input');

	startTurn(panel);
	input.value = 'create only 2 files not 3';
	panel.el('send-stop-btn').click();
	panel.finish();

	const submitted = submitMessages(panel);
	t.is(submitted.length, 1);
	t.like(submitted[0], {
		type: 'submitMessage',
		text: 'create only 2 files not 3',
	});
});

test('Stop discards parked follow-ups so they do not fire after cancel', t => {
	const panel = createPanel();
	const input = panel.el('chat-input');

	startTurn(panel);
	input.value = 'do not run this';
	panel.el('send-stop-btn').click();
	input.value = '';
	input.dispatchEvent({type: 'input'});
	panel.el('send-stop-btn').click();
	panel.finish();

	t.is(
		submitMessages(panel).length,
		0,
		'Cancel must not flush a parked follow-up when the cancelled turn reports done',
	);
	t.falsy(panel.container.querySelector('.queued-badge'));
});

test('the Queued badge remove button drops the follow-up before it ever runs', t => {
	const panel = createPanel();
	const input = panel.el('chat-input');

	startTurn(panel);
	input.value = 'never mind this one';
	panel.el('send-stop-btn').click();

	const badge = panel.container.querySelector('.queued-badge');
	const queuedId = badge.parentElement.getAttribute('data-message-id');
	badge.querySelector('button').click();

	t.deepEqual(
		panel.sent.filter(
			(message: {type?: string}) => message.type === 'cancelQueuedMessage',
		),
		[{type: 'cancelQueuedMessage', id: queuedId}],
		'The host owns the queue too, so a webview-side removal must be forwarded',
	);
	t.falsy(panel.container.querySelector('.queued-badge'));

	panel.finish();

	t.is(
		submitMessages(panel).length,
		0,
		'A removed follow-up must not be dispatched when the in-flight turn ends',
	);
});

test('promptQueued paints a Queued badge on the matching bubble', t => {
	const panel = createPanel();
	const input = panel.el('chat-input');

	input.value = 'follow-up';
	panel.el('send-stop-btn').click();

	const submitted = panel.sent.find(
		(message: {type?: string; id?: string}) => message.type === 'submitMessage',
	) as {id: string} | undefined;
	t.truthy(submitted?.id);

	panel.post({type: 'promptQueued', id: submitted?.id});

	t.truthy(
		panel.container.querySelector('.queued-badge'),
		'The host-owned Queued badge is how the user sees the park',
	);
});

test('panel posts ready after boot so the host can create the ACP session', t => {
	const panel = createPanel();
	t.true(
		panel.sent.some((message: {type?: string}) => message.type === 'ready'),
		'Without ready the host never calls newSession and the dropdowns stay on Loading…',
	);
});

test('connectionStatus connecting shows a status line that connected clears', t => {
	const panel = createPanel();
	panel.post({
		type: 'connectionStatus',
		status: 'connecting',
		message: 'Connecting to Nanocoder…',
	});
	t.is(panel.el('connection-status')?.textContent, 'Connecting to Nanocoder…');

	panel.post({type: 'connectionStatus', status: 'connected'});
	t.is(panel.el('connection-status'), null);
});
