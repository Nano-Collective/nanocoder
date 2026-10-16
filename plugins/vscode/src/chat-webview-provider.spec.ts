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
