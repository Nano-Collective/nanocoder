import test from 'ava';
import type {MCPClient} from '../mcp/mcp-client.js';
import {PlaceholderType} from '../types/hooks.js';
import {handleResourceMention} from './resource-mention-handler.js';

console.log('\nresource-mention-handler.spec.ts');

// Mock MCP Client — only `readResource` is exercised, matching the real
// contract: `(serverName, uri) => Promise<MCPResourceContent[]>`.
class MockMCPClient {
	constructor(
		private readonly reader: (
			serverName: string,
			uri: string,
		) => Promise<Array<{uri: string; mimeType?: string; text?: string; blob?: string}>>,
	) {}

	async readResource(serverName: string, uri: string) {
		return this.reader(serverName, uri);
	}
}

function clientReturning(
	blocks: Array<{uri: string; mimeType?: string; text?: string; blob?: string}>,
): MCPClient {
	return new MockMCPClient(async () => blocks) as unknown as MCPClient;
}

test('handleResourceMention: creates a placeholder from a text resource', async t => {
	const mockClient = clientReturning([
		{uri: 'file:///test/resource.txt', mimeType: 'text/plain', text: 'hello'},
	]);

	const result = await handleResourceMention(
		mockClient,
		'test-server',
		'file:///test/resource.txt',
		'resource.txt',
		'Check this @resource.txt',
		{},
		'@resource.txt',
	);

	t.truthy(result);
	t.is(result!.displayValue, 'Check this [@resource.txt]');

	const placeholders = Object.values(result!.placeholderContent);
	t.is(placeholders.length, 1);
	t.is(placeholders[0].type, PlaceholderType.RESOURCE);

	if (placeholders[0].type === PlaceholderType.RESOURCE) {
		t.is(placeholders[0].uri, 'file:///test/resource.txt');
		t.is(placeholders[0].resourceName, 'resource.txt');
		t.is(placeholders[0].serverName, 'test-server');
		t.is(placeholders[0].content, 'hello');
		t.is(placeholders[0].mimeType, 'text/plain');
	}
});

test('handleResourceMention: returns null when the server returns no content blocks', async t => {
	const mockClient = clientReturning([]);

	const result = await handleResourceMention(
		mockClient,
		'test-server',
		'file:///empty',
		'empty',
		'Check this @empty',
		{},
		'@empty',
	);

	t.is(result, null);
});

test('handleResourceMention: handles resource read errors gracefully', async t => {
	const mockClient = new MockMCPClient(async () => {
		throw new Error('Read failed');
	}) as unknown as MCPClient;

	const result = await handleResourceMention(
		mockClient,
		'test-server',
		'file:///test/resource.txt',
		'resource.txt',
		'Check this @resource.txt',
		{},
		'@resource.txt',
	);

	t.is(result, null);
});

test('handleResourceMention: preserves existing placeholders', async t => {
	const mockClient = clientReturning([
		{uri: 'file:///test/resource.txt', mimeType: 'text/plain', text: 'hi'},
	]);

	const existingPlaceholder = {
		paste_1: {
			type: PlaceholderType.PASTE,
			displayText: '[Paste #1]',
			content: 'existing content',
			originalSize: 16,
		},
	};

	const result = await handleResourceMention(
		mockClient,
		'test-server',
		'file:///test/resource.txt',
		'resource.txt',
		'Text [Paste #1] and @resource.txt',
		existingPlaceholder,
		'@resource.txt',
	);

	t.truthy(result);

	const placeholders = Object.values(result!.placeholderContent);
	t.is(placeholders.length, 2);
	t.truthy(result!.placeholderContent.paste_1);
});

test('handleResourceMention: a binary block becomes a placeholder note, not raw base64', async t => {
	const mockClient = clientReturning([
		{uri: 'file:///image.png', mimeType: 'image/png', blob: 'aGVsbG8='},
	]);

	const result = await handleResourceMention(
		mockClient,
		'test-server',
		'file:///image.png',
		'image.png',
		'Check @image.png',
		{},
		'@image.png',
	);

	t.truthy(result);
	const placeholders = Object.values(result!.placeholderContent);
	t.is(placeholders.length, 1);

	if (placeholders[0].type === PlaceholderType.RESOURCE) {
		t.false(placeholders[0].content.includes('aGVsbG8='));
		t.regex(placeholders[0].content, /binary resource.*image\/png/);
	}
});

test('handleResourceMention: joins multiple content blocks with a blank line', async t => {
	const mockClient = clientReturning([
		{uri: 'file:///multi', mimeType: 'text/plain', text: 'first'},
		{uri: 'file:///multi', mimeType: 'text/plain', text: 'second'},
	]);

	const result = await handleResourceMention(
		mockClient,
		'test-server',
		'file:///multi',
		'multi',
		'Check @multi',
		{},
		'@multi',
	);

	t.truthy(result);
	const placeholders = Object.values(result!.placeholderContent);
	if (placeholders[0].type === PlaceholderType.RESOURCE) {
		t.is(placeholders[0].content, 'first\n\nsecond');
	}
});
