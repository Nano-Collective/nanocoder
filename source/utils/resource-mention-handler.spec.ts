import test from 'ava';
import {PlaceholderType} from '../types/hooks.js';
import {handleResourceMention} from './resource-mention-handler.js';
import type {MCPClient} from '../mcp/mcp-client.js';

console.log('\nresource-mention-handler.spec.ts');

// Mock MCP Client
class MockMCPClient {
	private resources: any[];

	constructor(resources: any[]) {
		this.resources = resources;
	}

	getAllResources() {
		return this.resources;
	}

	async readResource(uri: string) {
		const resource = this.resources.find(r => r.uri === uri);
		if (!resource) {
			throw new Error('Resource not found');
		}
		return {
			uri,
			text: `Content of ${resource.name}`,
			mimeType: resource.mimeType,
		};
	}
}

test('handleResourceMention: creates placeholder for valid resource', async t => {
	const mockClient = new MockMCPClient([
		{
			uri: 'file:///test/resource.txt',
			name: 'resource.txt',
			description: 'Test resource',
			mimeType: 'text/plain',
			serverName: 'test-server',
		},
	]) as unknown as MCPClient;

	const result = await handleResourceMention(
		mockClient,
		'file:///test/resource.txt',
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
		t.is(placeholders[0].content, 'Content of resource.txt');
	}
});

test('handleResourceMention: returns null for non-existent resource', async t => {
	const mockClient = new MockMCPClient([]) as unknown as MCPClient;

	const result = await handleResourceMention(
		mockClient,
		'file:///non-existent',
		'Check this @non-existent',
		{},
		'@non-existent',
	);

	t.is(result, null);
});

test('handleResourceMention: handles resource read errors gracefully', async t => {
	const mockClient = new MockMCPClient([
		{
			uri: 'file:///test/resource.txt',
			name: 'resource.txt',
			serverName: 'test-server',
		},
	]);

	// Override readResource to throw an error
	mockClient.readResource = async () => {
		throw new Error('Read failed');
	};

	const result = await handleResourceMention(
		mockClient as unknown as MCPClient,
		'file:///test/resource.txt',
		'Check this @resource.txt',
		{},
		'@resource.txt',
	);

	t.is(result, null);
});

test('handleResourceMention: preserves existing placeholders', async t => {
	const mockClient = new MockMCPClient([
		{
			uri: 'file:///test/resource.txt',
			name: 'resource.txt',
			mimeType: 'text/plain',
			serverName: 'test-server',
		},
	]) as unknown as MCPClient;

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
		'file:///test/resource.txt',
		'Text [Paste #1] and @resource.txt',
		existingPlaceholder,
		'@resource.txt',
	);

	t.truthy(result);

	const placeholders = Object.values(result!.placeholderContent);
	t.is(placeholders.length, 2);

	// Original placeholder should still be there
	t.truthy(result!.placeholderContent.paste_1);
});

test('handleResourceMention: includes mimeType in placeholder', async t => {
	const mockClient = new MockMCPClient([
		{
			uri: 'file:///test/data.json',
			name: 'data.json',
			mimeType: 'application/json',
			serverName: 'test-server',
		},
	]) as unknown as MCPClient;

	const result = await handleResourceMention(
		mockClient,
		'file:///test/data.json',
		'Check @data.json',
		{},
		'@data.json',
	);

	t.truthy(result);

	const placeholders = Object.values(result!.placeholderContent);
	t.is(placeholders.length, 1);

	if (placeholders[0].type === PlaceholderType.RESOURCE) {
		t.is(placeholders[0].mimeType, 'application/json');
	}
});
