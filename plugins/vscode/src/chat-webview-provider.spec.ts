import test from 'ava';
import * as vscode from 'vscode';
import { ChatWebviewProvider } from './chat-webview-provider';
import { NanocoderAcpClient } from './acp-client';

function makeStubs() {
	const outputChannel = {appendLine: () => {}} as any;
	const diffManager = {} as any;

	const acpClient = {
		hasPendingPermissions: () => false,
		hasActivePrompt: () => false,
		currentMode: undefined,
		getOrCreateSession: async () => 'session-1',
		prompt: async () => ({stopReason: 'end_turn'}),
	} as any as NanocoderAcpClient;

	let postMessageCalls = 0;
	const postedMessages: any[] = [];

	const provider = new ChatWebviewProvider(
		vscode.Uri.file('/fake'),
		outputChannel,
		acpClient,
		diffManager,
	);
	// Inject the view directly instead of running resolveWebviewView, which
	// reads media/chat-panel.html off disk and needs a real Webview.
	(provider as any)._view = {
		webview: {
			postMessage: (msg: any) => {
				postMessageCalls++;
				postedMessages.push(msg);
				return undefined;
			},
		},
	};

	return {
		provider,
		acpClient,
		getPostMessageCalls: () => postMessageCalls,
		getPostedMessages: () => postedMessages.slice(),
		resetPostedMessages: () => {
			postedMessages.length = 0;
			postMessageCalls = 0;
		},
	};
}

test('ChatWebviewProvider - _handleSubmit queues a follow-up while a turn is in flight', async (t) => {
	const {provider, acpClient, getPostedMessages} = makeStubs();

	// Mark a turn in flight via the queue's public API: submit() is what
	// flips turnActive to true when the previous prompt started running.
	// We don't drive the rest of _runTurn here - we only need the queue state.
	(provider as any)._queue.submit({id: 'msg-in-flight', text: 'first prompt'});

	let promptCalls = 0;
	let getOrCreateCalls = 0;
	(acpClient as any).prompt = () => {
		promptCalls++;
		return Promise.resolve({stopReason: 'end_turn'});
	};
	(acpClient as any).getOrCreateSession = () => {
		getOrCreateCalls++;
		return Promise.resolve('session-1');
	};

	const postedBefore = getPostedMessages().length;
	(provider as any)._handleSubmit('msg-follow-up', 'follow-up question');

	t.is(promptCalls, 0, 'must not call acpClient.prompt while a follow-up is queued');
	t.is(
		getOrCreateCalls,
		0,
		'must not call getOrCreateSession until the queued follow-up is drained',
	);
	t.deepEqual(
		(provider as any)._queue.ids,
		['msg-follow-up'],
		'the follow-up should sit in the host queue waiting for the in-flight turn',
	);

	const newMessages = getPostedMessages().slice(postedBefore);
	t.true(
		newMessages.some(m => m.type === 'promptQueued' && m.id === 'msg-follow-up'),
		'the webview must be told the follow-up is queued so it can paint the Queued badge',
	);
});

test('ChatWebviewProvider - _handleSubmit warns and drops a submit when idle but a tool approval is pending', async (t) => {
	const originalShowWarning = vscode.window.showWarningMessage;
	const warnings: string[] = [];
	(vscode.window as any).showWarningMessage = (msg: string) => {
		warnings.push(msg);
		return Promise.resolve(undefined);
	};
	t.teardown(() => {
		(vscode.window as any).showWarningMessage = originalShowWarning;
	});

	const {provider, acpClient, getPostedMessages} = makeStubs();

	// Queue idle (no turn in flight) but a tool approval is pending - the only
	// state in which the user-facing warning fires. A follow-up typed while a turn
	// is in flight is allowed to queue (see the other test); here a typed
	// follow-up would otherwise race the approval and the turn would never run,
	// so we block it.
	(acpClient as any).hasPendingPermissions = () => true;

	let promptCalls = 0;
	(acpClient as any).prompt = () => {
		promptCalls++;
		return Promise.resolve({stopReason: 'end_turn'});
	};

	const postedBefore = getPostedMessages().length;
	(provider as any)._handleSubmit('msg-test', 'remote question');

	t.is(promptCalls, 0, 'must not call acpClient.prompt when an approval is pending and the queue is idle');
	t.deepEqual(
		(provider as any)._queue.ids,
		[],
		'nothing should be queued: the user must resolve the approval first',
	);
	t.true(
		warnings.some(w => /approve or deny/i.test(w)),
		'the user must be told to approve or deny the pending tool before typing a new message',
	);

	const newMessages = getPostedMessages().slice(postedBefore);
	t.true(
		newMessages.some(
			m => m.type === 'acpUpdate'
				&& m.update?.sessionUpdate === 'prompt_response'
				&& m.update?.outcome === 'failed',
		),
		'the webview must clear its loading state via a failed prompt_response',
	);
});