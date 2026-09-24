import test from 'ava';
import * as vscode from 'vscode';
import { ChatWebviewProvider } from './chat-webview-provider';
import { NanocoderAcpClient } from './acp-client';

function makeStubs() {
	const outputChannel = {appendLine: () => {}} as any;
	const diffManager = {} as any;

	const acpClient = {
		hasPendingPermissions: () => false,
		activePrompt: undefined as any,
		currentMode: undefined,
		getOrCreateSession: async () => 'session-1',
		prompt: async () => ({stopReason: 'end_turn'}),
	} as any as NanocoderAcpClient;

	let postMessageCalls = 0;

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
			postMessage: () => {
				postMessageCalls++;
				return undefined;
			},
		},
	};

	return {provider, acpClient, getPostMessageCalls: () => postMessageCalls};
}

test('ChatWebviewProvider - _handlePrompt rejects a submit when a turn is already in flight', async (t) => {
	const originalShowWarning = vscode.window.showWarningMessage;
	const warnings: string[] = [];
	(vscode.window as any).showWarningMessage = (msg: string) => {
		warnings.push(msg);
		return Promise.resolve(undefined);
	};
	t.teardown(() => {
		(vscode.window as any).showWarningMessage = originalShowWarning;
	});

	const {provider, acpClient, getPostMessageCalls} = makeStubs();

	// Pre-set activePrompt to mirror the state acpClient.prompt() leaves the
	// field in for the duration of a turn - the busy-check reads it and bails.
	(acpClient as any).activePrompt = {cancel: () => {}};

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

	const postMessagesBefore = getPostMessageCalls();

	await (provider as any)._handlePrompt('second message');

	t.is(promptCalls, 0, 'must not have called acpClient.prompt while a turn is already in flight');
	t.is(
		getOrCreateCalls,
		0,
		'must not have even called getOrCreateSession - the busy check is the very first thing the handler does',
	);
	t.true(
		warnings.some(w => w.includes('turn is already in progress')),
		'the user must be warned that a turn is already in progress',
	);
	t.true(
		getPostMessageCalls() > postMessagesBefore,
		'the webview must receive at least one message so it can reset its loading state',
	);
});
