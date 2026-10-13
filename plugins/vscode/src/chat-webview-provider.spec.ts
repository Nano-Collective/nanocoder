import test from 'ava';
import * as vscode from 'vscode';
import { ChatWebviewProvider } from './chat-webview-provider';
import { NanocoderAcpClient } from './acp-client';

function makeStubs() {
	const outputChannel = {appendLine: () => {}} as any;
	const pendingChangesAdded: any[] = [];
	let clearPendingChangesCalls = 0;
	const showDiffCalls: any[] = [];
	const diffManager = {
		addPendingChange: (change: any) => {
			pendingChangesAdded.push(change);
		},
		clearPendingChanges: async () => {
			clearPendingChangesCalls++;
		},
		showDiff: async (id: string, options?: any) => {
			showDiffCalls.push({id, options});
		},
		getPendingChanges: () => pendingChangesAdded,
	} as any;

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
		diffManager,
		getPendingChangesAdded: () => pendingChangesAdded.slice(),
		getClearPendingChangesCalls: () => clearPendingChangesCalls,
		getShowDiffCalls: () => showDiffCalls.slice(),
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

test('ChatWebviewProvider - handleDiffs keys pending changes uniquely when multiple diffs share toolCallId', async (t) => {
	const {provider, getPendingChangesAdded} = makeStubs();

	(provider as any).handleDiffs({
		update: {
			toolCallId: 'tool-call-123',
			title: 'edit',
			content: [
				{
					type: 'diff',
					path: 'src/foo.ts',
					oldText: 'const a = 1;',
					newText: 'const a = 2;',
				},
				{
					type: 'diff',
					path: 'src/bar.ts',
					oldText: 'const b = 1;',
					newText: 'const b = 2;',
				},
			],
		},
	});

	const added = getPendingChangesAdded();
	t.is(added.length, 2, 'both diff blocks must be added as pending changes');
	t.not(added[0].id, added[1].id, 'diff IDs must be unique even when sharing toolCallId');
	t.true(added[0].id.startsWith('tool-call-123_'));
	t.true(added[1].id.startsWith('tool-call-123_'));
	t.is(added[0].filePath, 'src/foo.ts');
	t.is(added[1].filePath, 'src/bar.ts');
});

test('ChatWebviewProvider - resetSessionState clears pending diff changes', async (t) => {
	const {provider, getClearPendingChangesCalls} = makeStubs();

	t.is(getClearPendingChangesCalls(), 0);
	provider.resetSessionState();
	t.is(getClearPendingChangesCalls(), 1, 'clearPendingChanges must be called on resetSessionState');
});

test('ChatWebviewProvider - onConnectionReady clears pending diff changes', async (t) => {
	const {acpClient, getClearPendingChangesCalls} = makeStubs();

	t.is(getClearPendingChangesCalls(), 0);
	acpClient.onConnectionReady?.();
	t.is(getClearPendingChangesCalls(), 1, 'clearPendingChanges must be called on onConnectionReady');
});