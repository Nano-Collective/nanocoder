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
		isHandshakeComplete: true,
		lastActiveSessionId: undefined,
		listSessions: async () => [],
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

// `@` mention search only covers a folder the user chose: `nanocoder.cwd` or
// the first workspace folder. The home-directory fallback that sessions use
// must never be crawled.
function mentionDeps() {
	const {provider} = makeStubs();
	return (provider as any)._mentionSearchDeps() as {
		workspaceRoot: string;
		findFiles(glob: string, limit: number): Promise<string[]>;
	};
}

function resetMentionStubs() {
	(vscode as any).__test.reset();
	(vscode.workspace as any).workspaceFolders = undefined;
}

test.serial('mention search finds nothing when no folder is open and nanocoder.cwd is unset', async (t) => {
	resetMentionStubs();
	try {
		let searches = 0;
		(vscode as any).__test.findFiles = async () => {
			searches++;
			return [vscode.Uri.file('/home/user/private.txt')];
		};

		t.deepEqual(await mentionDeps().findFiles('**/*a*', 5), []);
		t.is(searches, 0, 'the home-directory fallback must not be searched');
	} finally {
		resetMentionStubs();
	}
});

test.serial('mention search covers the configured nanocoder.cwd, not the first workspace folder', async (t) => {
	resetMentionStubs();
	try {
		(vscode.workspace as any).workspaceFolders = [{uri: vscode.Uri.file('/workspace')}];
		(vscode as any).__test.configuration = (section: string, key: string, fallback: unknown) =>
			section === 'nanocoder' && key === 'cwd' ? '/custom/project' : fallback;
		let searchedBase = '';
		(vscode as any).__test.findFiles = async (include: {base: {fsPath: string}}) => {
			searchedBase = include.base.fsPath;
			return [vscode.Uri.file('/custom/project/a.ts')];
		};

		const deps = mentionDeps();
		t.is(deps.workspaceRoot, '/custom/project');
		t.deepEqual(await deps.findFiles('**/*a*', 5), ['/custom/project/a.ts']);
		t.is(searchedBase, '/custom/project');
	} finally {
		resetMentionStubs();
	}
});

test.serial('mention search covers the workspace folder when nanocoder.cwd is unset', async (t) => {
	resetMentionStubs();
	try {
		(vscode.workspace as any).workspaceFolders = [{uri: vscode.Uri.file('/workspace')}];
		let searchedBase = '';
		(vscode as any).__test.findFiles = async (include: {base: {fsPath: string}}) => {
			searchedBase = include.base.fsPath;
			return [vscode.Uri.file('/workspace/b.ts')];
		};

		t.deepEqual(await mentionDeps().findFiles('**/*b*', 5), ['/workspace/b.ts']);
		t.is(searchedBase, '/workspace');
	} finally {
		resetMentionStubs();
	}
});

test('ChatWebviewProvider - _initializeSessionIfReady exercises resumeSession end-to-end on reconnection', async (t) => {
	const {provider, acpClient, getPostedMessages, resetPostedMessages} = makeStubs();
	(provider as any)._isWebviewReady = true;
	(acpClient as any).isHandshakeComplete = true;
	(acpClient as any).lastActiveSessionId = 'session-reconnect';

	let resumedSessionId = '';
	(acpClient as any).resumeSession = async (id: string) => {
		resumedSessionId = id;
		return true;
	};

	resetPostedMessages();
	await (provider as any)._initializeSessionIfReady();

	t.is(resumedSessionId, 'session-reconnect', 'must call acpClient.resumeSession with lastActiveSessionId');
	t.is(acpClient.lastActiveSessionId, undefined, 'lastActiveSessionId should be consumed');
	const messages = getPostedMessages();
	t.true(
		messages.some(m => m.type === 'clear' && m.isLoading === true),
		'real resumeSession must post clear with isLoading true',
	);
	t.true(
		messages.some(m => m.type === 'sessionLoaded'),
		'real resumeSession must post sessionLoaded in finally block',
	);
	t.true(
		messages.some(m => m.type === 'connectionStatus' && m.status === 'connected'),
		'_initializeSessionIfReady must post connected status',
	);
});

test('ChatWebviewProvider - _initializeSessionIfReady resets webview and announces when resume of previous session fails', async (t) => {
	const {provider, acpClient, getPostedMessages, resetPostedMessages} = makeStubs();
	(provider as any)._isWebviewReady = true;
	(acpClient as any).isHandshakeComplete = true;
	(acpClient as any).lastActiveSessionId = 'session-unresumable';

	(acpClient as any).resumeSession = async () => false;
	(acpClient as any).getOrCreateSession = async () => 'session-fresh-uuid';

	resetPostedMessages();
	await (provider as any)._initializeSessionIfReady();

	const messages = getPostedMessages();
	t.true(messages.some(m => m.type === 'clear' && !m.isLoading), 'must clear webview when falling back to new session');
	t.true(
		messages.some(
			m =>
				m.type === 'appendMessage' &&
				typeof m.content === 'string' &&
				m.content.includes('restarted in a fresh session'),
		),
		'must announce the fresh session restart',
	);
	t.true(messages.some(m => m.type === 'connectionStatus' && m.status === 'connected'));
});

test('ChatWebviewProvider - _initializeSessionIfReady safely falls back when resumeSession throws', async (t) => {
	const {provider, acpClient, getPostedMessages, resetPostedMessages} = makeStubs();
	(provider as any)._isWebviewReady = true;
	(acpClient as any).isHandshakeComplete = true;
	(acpClient as any).lastActiveSessionId = 'session-error';

	(acpClient as any).resumeSession = async () => {
		throw new Error('Connection failed abruptly');
	};
	(acpClient as any).getOrCreateSession = async () => 'session-fresh-uuid';

	resetPostedMessages();
	await (provider as any)._initializeSessionIfReady();

	const messages = getPostedMessages();
	t.true(messages.some(m => m.type === 'clear' && !m.isLoading), 'must clear webview when fallback triggers');
	t.true(
		messages.some(
			m =>
				m.type === 'appendMessage' &&
				typeof m.content === 'string' &&
				m.content.includes('restarted in a fresh session'),
		),
		'must announce the fresh session restart even if resumeSession threw an exception',
	);
	t.true(messages.some(m => m.type === 'connectionStatus' && m.status === 'connected'));
});

