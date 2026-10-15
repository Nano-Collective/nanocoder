import test from 'ava';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {AcpProcessManager} from './acp-process-manager';
import {ChatWebviewProvider} from './chat-webview-provider';
import {activate} from './extension';

/**
 * Runs the real `activate()` against the vscode stub, capturing what it
 * registers. `AcpProcessManager.launch` is replaced so nothing is spawned;
 * the count is how many times the agent process would have started.
 */
function activateExtension(t: import('ava').ExecutionContext) {
	const commands = new Map<string, (...args: unknown[]) => unknown>();
	let viewProvider: vscode.WebviewViewProvider | undefined;
	let launches = 0;

	const originals = {
		registerCommand: vscode.commands.registerCommand,
		registerWebviewViewProvider: vscode.window.registerWebviewViewProvider,
		registerTextDocumentContentProvider: (vscode.workspace as any)
			.registerTextDocumentContentProvider,
		launch: (AcpProcessManager.prototype as any).launch,
		resolveWebviewView: ChatWebviewProvider.prototype.resolveWebviewView,
	};
	const disposable = {dispose: () => {}};
	(vscode.commands as any).registerCommand = (
		id: string,
		handler: (...args: unknown[]) => unknown,
	) => {
		commands.set(id, handler);
		return disposable;
	};
	(vscode.window as any).registerWebviewViewProvider = (
		viewType: string,
		provider: vscode.WebviewViewProvider,
	) => {
		if (viewType === ChatWebviewProvider.viewType) viewProvider = provider;
		return disposable;
	};
	(vscode.workspace as any).registerTextDocumentContentProvider = () => disposable;
	(AcpProcessManager.prototype as any).launch = async () => {
		launches++;
	};
	// The real resolve renders media/chat-panel.html into a live webview.
	ChatWebviewProvider.prototype.resolveWebviewView = () => {};
	// The manifest's default: the legacy companion stays off, so activate()
	// does not schedule a WebSocket connect that would outlive the test.
	(vscode as any).__test.configuration = (
		_section: string,
		key: string,
		fallback: unknown,
	) => (key === 'autoConnect' ? false : fallback);

	const context = {
		subscriptions: [] as {dispose(): unknown}[],
		extensionUri: vscode.Uri.file('/fake-extension'),
	} as unknown as vscode.ExtensionContext;

	t.teardown(() => {
		for (const subscription of context.subscriptions) {
			try {
				subscription.dispose();
			} catch {}
		}
		(vscode.commands as any).registerCommand = originals.registerCommand;
		(vscode.window as any).registerWebviewViewProvider =
			originals.registerWebviewViewProvider;
		(vscode.workspace as any).registerTextDocumentContentProvider =
			originals.registerTextDocumentContentProvider;
		(AcpProcessManager.prototype as any).launch = originals.launch;
		ChatWebviewProvider.prototype.resolveWebviewView = originals.resolveWebviewView;
		(vscode as any).__test.reset();
	});

	activate(context);

	return {
		commands,
		resolveChatView: () =>
			viewProvider?.resolveWebviewView({} as any, {} as any, {} as any),
		launches: () => launches,
	};
}

/** Let fire-and-forget launches settle. */
const settle = () => new Promise(resolve => setImmediate(resolve));

test.serial('activation does not spawn the agent process', async t => {
	const extension = activateExtension(t);
	await settle();

	t.is(extension.launches(), 0);
});

test.serial('opening the chat view spawns the agent process once', async t => {
	const extension = activateExtension(t);

	extension.resolveChatView();
	await settle();
	t.is(extension.launches(), 1);

	// VS Code re-resolves the view (e.g. after it was moved); no second process.
	extension.resolveChatView();
	await settle();
	t.is(extension.launches(), 1);
});

test.serial('commands that do not talk to the agent do not spawn it', async t => {
	const extension = activateExtension(t);

	await extension.commands.get('nanocoder.showOutput')?.();
	await extension.commands.get('nanocoder.openConfig')?.();
	await settle();

	t.is(extension.launches(), 0);
});

test.serial('restarting the agent before the chat view opens starts it once', async t => {
	const extension = activateExtension(t);

	await extension.commands.get('nanocoder.restartAcp')?.();
	await settle();
	extension.resolveChatView();
	await settle();

	t.is(extension.launches(), 1);
});

test('the manifest has no startup activation, so VS Code activates on use', t => {
	const manifest = JSON.parse(
		fs.readFileSync(
			path.join(process.cwd(), 'plugins', 'vscode', 'package.json'),
			'utf8',
		),
	);

	t.false(manifest.activationEvents.includes('onStartupFinished'));
	// VS Code >= 1.74 derives onView / onCommand activation from these.
	t.true(
		manifest.contributes.views['nanocoder-sidebar'].some(
			(view: {id: string}) => view.id === ChatWebviewProvider.viewType,
		),
	);
	t.regex(manifest.engines.vscode, /^\^1\.(7[4-9]|[89]\d|\d{3,})\./);
});
