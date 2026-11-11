import test from 'ava';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ChatWebviewProvider, getNonce } from './chat-webview-provider';
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

test('ChatWebviewProvider - an @[file] attachment sends the open editor\'s unsaved edits, not the saved file', t => {
	const {provider} = makeStubs();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-attach-'));
	const filePath = path.join(dir, 'draft.ts');
	fs.writeFileSync(filePath, 'export const saved = 1;\n');

	const originalDocuments = vscode.workspace.textDocuments;
	(vscode.workspace as any).textDocuments = [
		{uri: vscode.Uri.file(filePath), getText: () => 'export const unsaved = 2;\n'},
	];
	t.teardown(() => {
		(vscode.workspace as any).textDocuments = originalDocuments;
		fs.rmSync(dir, {recursive: true, force: true});
	});

	const expanded = (provider as any)._expandContextAttachments(
		`What does this export?\n\n@[file] ${filePath}`,
	);

	t.true(expanded.includes('export const unsaved = 2;'), expanded);
	t.false(expanded.includes('export const saved = 1;'), expanded);
});

test('ChatWebviewProvider - an @[file] attachment ignores open documents that are not the file on disk', t => {
	const {provider} = makeStubs();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-attach-'));
	const filePath = path.join(dir, 'draft.ts');
	fs.writeFileSync(filePath, 'export const saved = 1;\n');

	const originalDocuments = vscode.workspace.textDocuments;
	// Same path, but an untitled buffer and a git diff view, not the file itself.
	(vscode.workspace as any).textDocuments = [
		{uri: {scheme: 'untitled', fsPath: filePath}, getText: () => 'untitled buffer'},
		{uri: {scheme: 'git', fsPath: filePath}, getText: () => 'git diff view'},
	];
	t.teardown(() => {
		(vscode.workspace as any).textDocuments = originalDocuments;
		fs.rmSync(dir, {recursive: true, force: true});
	});

	const expanded = (provider as any)._expandContextAttachments(
		`What does this export?\n\n@[file] ${filePath}`,
	);

	t.true(expanded.includes('export const saved = 1;'), expanded);
	t.false(expanded.includes('untitled buffer'), expanded);
	t.false(expanded.includes('git diff view'), expanded);
});

/** Run a provider/model switch with a stubbed result and return what was shown. */
async function shownAfterSwitch(
	t: import('ava').ExecutionContext,
	kind: 'provider' | 'model',
	result: unknown,
) {
	const {provider, acpClient} = makeStubs();
	(acpClient as any).setSessionProvider = async () => result;
	(acpClient as any).setSessionModel = async () => result;
	(vscode as any).__test.shownMessages = [];
	t.teardown(() => (vscode as any).__test.reset());

	if (kind === 'provider') {
		await (provider as any)._switchProvider('ollama');
	} else {
		await (provider as any)._switchModel('qwen');
	}
	return (vscode as any).__test.shownMessages as {kind: string; message: string}[];
}

test('ChatWebviewProvider - a confirmed provider switch shows the success message', async t => {
	t.deepEqual(await shownAfterSwitch(t, 'provider', {ok: true}), [
		{kind: 'info', message: 'Nanocoder: Provider switched to ollama'},
	]);
});

test('ChatWebviewProvider - a failed provider switch shows an error, not success', async t => {
	t.deepEqual(
		await shownAfterSwitch(t, 'provider', {ok: false, error: 'Connection closed'}),
		[
			{
				kind: 'error',
				message: 'Nanocoder: Could not switch provider to ollama: Connection closed',
			},
		],
	);
});

test('ChatWebviewProvider - a failed model switch shows an error, not success', async t => {
	t.deepEqual(
		await shownAfterSwitch(t, 'model', {ok: false, error: 'no active session'}),
		[
			{
				kind: 'error',
				message: 'Nanocoder: Could not switch model to qwen: no active session',
			},
		],
	);
});

test('ChatWebviewProvider - a model switch that could not be saved says so', async t => {
	t.deepEqual(
		await shownAfterSwitch(t, 'model', {ok: true, persistError: 'settings.json is read-only'}),
		[
			{
				kind: 'warning',
				message:
					'Nanocoder: Model switched to qwen for this session, but it could not be saved as your default: settings.json is read-only',
			},
		],
	);
});

test('ChatWebviewProvider - a confirmed and saved model switch shows the success message', async t => {
	t.deepEqual(await shownAfterSwitch(t, 'model', {ok: true}), [
		{kind: 'info', message: 'Nanocoder: Model switched to qwen'},
	]);
});

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


test('ChatWebviewProvider - showDiff message from webview requests diff preview without terminal focus restoration', async (t) => {
	const {provider, getShowDiffCalls} = makeStubs();

	await (provider as any)._handleWebviewMessage({
		type: 'showDiff',
		toolCallId: 'tool-call-webview',
		filePath: 'src/file.ts',
	});

	const calls = getShowDiffCalls();
	t.is(calls.length, 1);
	t.is(calls[0].id, 'tool-call-webview');
	t.is(calls[0].options?.filePath, 'src/file.ts');
	t.falsy(calls[0].options?.restoreTerminalFocus, 'Webview showDiff must not set restoreTerminalFocus: true');
});

test('ChatWebviewProvider - resumeSession failure retains existing transcript and does not post clear or sessionLoaded', async (t) => {
	const {provider, acpClient, getPostedMessages, resetPostedMessages} = makeStubs();
	(acpClient as any).resumeSession = async () => false;

	resetPostedMessages();
	const result = await provider.resumeSession('session-fail');

	t.false(result);
	const messages = getPostedMessages();
	t.false(messages.some(m => m.type === 'clear'), 'must not clear the webview on failed resume');
	t.false(messages.some(m => m.type === 'sessionLoaded'), 'must not send sessionLoaded on failed resume');
});

test('ChatWebviewProvider - resumeSession success buffers updates and posts clear then updates then sessionLoaded', async (t) => {
	const {provider, acpClient, getPostedMessages, resetPostedMessages, getClearPendingChangesCalls} = makeStubs();
	(acpClient as any).resumeSession = async () => {
		(acpClient as any).onSessionUpdate?.({
			sessionUpdate: 'agent_message_chunk',
			content: {text: 'replayed turn'},
		});
		return true;
	};

	resetPostedMessages();
	const result = await provider.resumeSession('session-success');

	t.true(result);
	t.is(getClearPendingChangesCalls(), 1, 'clearPendingChanges must be called on resume success');
	const messages = getPostedMessages();
	const types = messages.map(m => m.type);
	const clearIdx = types.indexOf('clear');
	const updateIdx = types.indexOf('acpUpdate');
	const loadedIdx = types.indexOf('sessionLoaded');

	t.true(clearIdx !== -1, 'clear must be sent on success');
	t.true(updateIdx !== -1, 'buffered acpUpdate must be sent on success');
	t.true(loadedIdx !== -1, 'sessionLoaded must be sent on success');
	t.true(clearIdx < updateIdx, 'clear must precede buffered updates');
	t.true(updateIdx < loadedIdx, 'buffered updates must precede sessionLoaded');
});

test('ChatWebviewProvider - resumeSession buffers only incoming session replay updates', async (t) => {
	const {provider, acpClient, getPostedMessages, resetPostedMessages} = makeStubs();
	(acpClient as any).resumeSession = async () => {
		(acpClient as any).onSessionUpdate?.({
			sessionUpdate: 'agent_message_chunk',
			content: {text: 'replayed turn'},
		});
		(acpClient as any).onSessionArtifacts?.({
			artifactPath: '/path/to/artifact.md',
		});
		return true;
	};

	resetPostedMessages();
	const result = await provider.resumeSession('session-success');

	t.true(result);
	const messages = getPostedMessages();
	const updates = messages.filter(m => m.type === 'acpUpdate');
	t.is(updates.length, 1);
	t.is(updates[0].update.content.text, 'replayed turn');
});

test('ChatWebviewProvider - resumeSession guards against concurrent overlapping resume calls', async (t) => {
	const {provider, acpClient} = makeStubs();

	let resumeCalls = 0;
	let resolveResume: (val: boolean) => void = () => {};
	(acpClient as any).resumeSession = () => {
		resumeCalls++;
		return new Promise<boolean>(resolve => {
			resolveResume = resolve;
		});
	};

	const firstResume = provider.resumeSession('session-first');
	const secondResume = provider.resumeSession('session-second');

	const secondResult = await secondResume;
	t.false(secondResult, 'concurrent resume request must return false');
	t.is(resumeCalls, 1, 'must not invoke acpClient.resumeSession for concurrent request');

	resolveResume(true);
	const firstResult = await firstResume;
	t.true(firstResult, 'first resume request must complete successfully');
});

test('ChatWebviewProvider - resumeSession posts sessionResuming true and false', async (t) => {
	const {provider, acpClient, getPostedMessages, resetPostedMessages} = makeStubs();
	(acpClient as any).resumeSession = async () => true;

	resetPostedMessages();
	const result = await provider.resumeSession('session-test');

	t.true(result);
	const messages = getPostedMessages();
	const resumingMessages = messages.filter(m => m.type === 'sessionResuming');
	t.is(resumingMessages.length, 2);
	t.true(resumingMessages[0].isResuming);
	t.is(resumingMessages[0].sessionId, 'session-test');
	t.false(resumingMessages[1].isResuming);
	t.is(resumingMessages[1].sessionId, 'session-test');
});

test('ChatWebviewProvider - live updates from current session are streamed immediately and not buffered into replay', async (t) => {
	const {provider, acpClient, getPostedMessages, resetPostedMessages} = makeStubs();
	(acpClient as any).sessionId = 'current-active-session';
	(acpClient as any).resumeSession = async () => {
		// Live chunk from active streaming session:
		(acpClient as any).onSessionUpdate?.({
			sessionId: 'current-active-session',
			sessionUpdate: 'agent_message_chunk',
			content: {text: 'live streaming chunk'},
		});
		// Replay chunk for target session:
		(acpClient as any).onSessionUpdate?.({
			sessionId: 'target-resume-session',
			sessionUpdate: 'agent_message_chunk',
			content: {text: 'replayed chunk'},
		});
		return false; // Resume fails
	};

	resetPostedMessages();
	const result = await provider.resumeSession('target-resume-session');

	t.false(result);
	const messages = getPostedMessages();
	// Live chunk must have been posted to webview immediately, not dropped on failure
	const liveUpdate = messages.find(m => m.type === 'acpUpdate' && m.update.content.text === 'live streaming chunk');
	t.truthy(liveUpdate, 'live chunk from current session must not be dropped on resume failure');
	// Replay chunk must NOT have been posted since resume failed
	const replayUpdate = messages.find(m => m.type === 'acpUpdate' && m.update.content.text === 'replayed chunk');
	t.falsy(replayUpdate, 'replayed chunk from target session must not be posted on failed resume');
});

test('ChatWebviewProvider - _initializeSessionIfReady exercises resumeSession end-to-end on reconnection', async (t) => {
	const {provider, acpClient, getPostedMessages, resetPostedMessages} = makeStubs();
	(provider as any)._isWebviewReady = true;
	(acpClient as any).isHandshakeComplete = true;
	(acpClient as any).lastActiveSessionId = 'session-reconnect';

	let resumedSessionId = '';
	let passedOptions: any;
	(acpClient as any).resumeSession = async (id: string, options?: any) => {
		resumedSessionId = id;
		passedOptions = options;
		return true;
	};

	resetPostedMessages();
	await (provider as any)._initializeSessionIfReady();

	t.is(resumedSessionId, 'session-reconnect', 'must call acpClient.resumeSession with lastActiveSessionId');
	t.deepEqual(passedOptions, { silent: true }, 'must pass silent: true to suppress popup on restart');
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

test('ChatWebviewProvider - _initializeSessionIfReady skips restart fallback when manual resume is already in progress', async (t) => {
	const {provider, acpClient, getPostedMessages, resetPostedMessages} = makeStubs();
	(provider as any)._isWebviewReady = true;
	(acpClient as any).isHandshakeComplete = true;
	acpClient.lastActiveSessionId = 'session-prior';
	(provider as any)._isResumingSession = true;

	resetPostedMessages();
	await (provider as any)._initializeSessionIfReady();

	const messages = getPostedMessages();
	t.false(
		messages.some(
			m =>
				m.type === 'appendMessage' &&
				typeof m.content === 'string' &&
				m.content.includes('restarted in a fresh session'),
		),
		'must not post fresh session restart announcement when manual resume is in progress',
	);
	t.false(messages.some(m => m.type === 'clear'), 'must not clear webview transcript');
	t.true(messages.some(m => m.type === 'connectionStatus' && m.status === 'connected'));
});

test('getNonce - comes from a CSPRNG, not Math.random', (t) => {
	const originalRandom = Math.random;
	Math.random = () => 0.5;
	t.teardown(() => {
		Math.random = originalRandom;
	});

	const first = getNonce();
	const second = getNonce();

	t.regex(first, /^[0-9a-f]{32}$/, '128 bits, safe inside a CSP nonce and an HTML attribute');
	t.not(first, second, 'a predictable Math.random must not make the nonce predictable');
});
