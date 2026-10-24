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
	const {provider, acpClient, getPostedMessages, resetPostedMessages} = makeStubs();
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

test('ChatWebviewProvider - resumeSession buffers onSessionArtifacts and applies it on success', async (t) => {
	const {provider, acpClient, getPostedMessages, resetPostedMessages} = makeStubs();
	const testMeta = {
		'nanocoder/artifacts': [
			{kind: 'task', path: '/tmp/task.md'},
		],
	};

	(acpClient as any).resumeSession = async () => {
		(acpClient as any).onSessionArtifacts?.(testMeta);
		return true;
	};

	resetPostedMessages();
	const result = await provider.resumeSession('session-artifacts');

	t.true(result);
	t.deepEqual(
		(provider as any)._artifacts.artifacts,
		[{kind: 'task', path: '/tmp/task.md'}],
		'buffered artifacts metadata must be applied to ArtifactController',
	);
	const messages = getPostedMessages();
	const artifactMsg = messages.find(m => m.type === 'artifactsUpdated');
	t.truthy(artifactMsg, 'must post artifacts update to webview');
	t.is(artifactMsg.artifacts.length, 1);
	t.is(artifactMsg.artifacts[0].path, '/tmp/task.md');
});

test('ChatWebviewProvider - resumeSession rejects concurrent resume calls', async (t) => {
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


