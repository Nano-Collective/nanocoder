import test from 'ava';
import { ChatWebviewProvider } from './chat-webview-provider';
import * as vscode from 'vscode';

// Mock dependencies
const mockExtensionUri = { fsPath: '/test/path' } as vscode.Uri;
const mockAcpClient = {
	prompt: async (text: string, images?: any[]) => {},
	hasPendingPermissions: () => false,
	getOrCreateSession: async () => 'mock-session-id',
};
const mockOutputChannel = {
	appendLine: () => {},
};

test('ChatWebviewProvider._handlePrompt - invokes acpClient.prompt with text and images', async t => {
	// Create provider with mocked dependencies
	const provider = new ChatWebviewProvider(
		mockExtensionUri,
		mockOutputChannel as any,
		mockAcpClient as any,
		{} as any // diffManager
	);

	// Track arguments passed to prompt
	let promptArgs: any[] = [];
	mockAcpClient.prompt = async (text: string, images?: any[]) => {
		promptArgs = [text, images];
	};

	// Call the private method (using any to bypass access modifier in test)
	await (provider as any)['_handlePrompt']('Hello image', [
		{ data: 'base64data', mimeType: 'image/png' }
	]);

	t.is(promptArgs.length, 2);
	t.is(promptArgs[0], 'Hello image');
	t.deepEqual(promptArgs[1], [
		{ data: 'base64data', mimeType: 'image/png' }
	]);
});
