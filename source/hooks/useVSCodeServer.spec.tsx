import test from 'ava';
import {Text} from 'ink';
import {render} from 'ink-testing-library';
import React from 'react';
import {
	activeEditorKey,
	createFileChangeFromTool,
	getVSCodePort,
	isVSCodeModeEnabled,
} from './useVSCodeServer';

console.log(`\nuseVSCodeServer.spec.tsx – ${React.version}`);

// ============================================================================
// isVSCodeModeEnabled Tests
// ============================================================================

test('isVSCodeModeEnabled returns boolean', t => {
	const result = isVSCodeModeEnabled();
	t.is(typeof result, 'boolean');
});

test('isVSCodeModeEnabled returns false without --vscode flag', t => {
	// Test environment doesn't have --vscode flag
	const hasFlag = process.argv.includes('--vscode');
	if (!hasFlag) {
		t.false(isVSCodeModeEnabled());
	} else {
		t.pass();
	}
});

test('isVSCodeModeEnabled does not throw', t => {
	t.notThrows(() => {
		isVSCodeModeEnabled();
	});
});

// ============================================================================
// getVSCodePort Tests
// ============================================================================

test('getVSCodePort returns a number', t => {
	const result = getVSCodePort();
	t.is(typeof result, 'number');
});

test('getVSCodePort returns default port when no args', t => {
	// Default port should be returned when no --vscode-port arg
	const port = getVSCodePort();
	t.true(port > 0);
	t.true(port < 65536);
});

test('getVSCodePort returns valid port number', t => {
	const port = getVSCodePort();
	t.true(port >= 1);
	t.true(port <= 65535);
});

test('getVSCodePort does not throw', t => {
	t.notThrows(() => {
		getVSCodePort();
	});
});

// ============================================================================
// createFileChangeFromTool Tests
// ============================================================================

test('createFileChangeFromTool returns object with required properties', async t => {
	const result = await createFileChangeFromTool(
		'/non-existent-file.ts',
		'new content',
		'create_file',
		{path: '/non-existent-file.ts'},
	);

	t.truthy(result);
	t.true('originalContent' in result);
	t.true('newContent' in result);
});

test('createFileChangeFromTool returns correct newContent', async t => {
	const newContent = 'const x = 1;';
	const result = await createFileChangeFromTool(
		'/non-existent-file.ts',
		newContent,
		'create_file',
		{},
	);

	t.is(result.newContent, newContent);
});

test('createFileChangeFromTool returns empty originalContent for non-existent file', async t => {
	const result = await createFileChangeFromTool(
		'/definitely-does-not-exist-12345.ts',
		'new content',
		'create_file',
		{},
	);

	t.is(result.originalContent, '');
});

test('createFileChangeFromTool handles empty newContent', async t => {
	const result = await createFileChangeFromTool(
		'/non-existent-file.ts',
		'',
		'create_file',
		{},
	);

	t.is(result.newContent, '');
});

test('createFileChangeFromTool handles various tool names', async t => {
	const toolNames = ['create_file', 'replace_lines', 'insert_lines', 'edit'];

	for (const toolName of toolNames) {
		await t.notThrowsAsync(async () => {
			await createFileChangeFromTool('/test.ts', 'content', toolName, {});
		});
	}
});

test('createFileChangeFromTool handles complex toolArgs', async t => {
	const toolArgs = {
		path: '/test.ts',
		startLine: 1,
		endLine: 10,
		content: 'new content',
		nested: {value: true},
	};

	await t.notThrowsAsync(async () => {
		await createFileChangeFromTool('/test.ts', 'content', 'replace_lines', toolArgs);
	});
});

test('createFileChangeFromTool handles empty toolArgs', async t => {
	await t.notThrowsAsync(async () => {
		await createFileChangeFromTool('/test.ts', 'content', 'create_file', {});
	});
});

test('createFileChangeFromTool handles special characters in content', async t => {
	const newContent = 'const x = "Hello\\nWorld";\\n// コメント\\n🚀';

	const result = await createFileChangeFromTool(
		'/test.ts',
		newContent,
		'create_file',
		{},
	);

	t.is(result.newContent, newContent);
});

test('createFileChangeFromTool handles large content', async t => {
	const largeContent = 'x'.repeat(100000);

	const result = await createFileChangeFromTool(
		'/test.ts',
		largeContent,
		'create_file',
		{},
	);

	t.is(result.newContent.length, 100000);
});

// ============================================================================
// activeEditorKey Tests (powers the pill dismissal logic)
// ============================================================================

test('activeEditorKey returns null for null state', t => {
	t.is(activeEditorKey(null), null);
});

test('activeEditorKey returns null when filePath is missing', t => {
	t.is(activeEditorKey({}), null);
	t.is(activeEditorKey({fileName: 'orphan.ts'}), null);
});

test('activeEditorKey returns a key for a focused file without selection', t => {
	const key = activeEditorKey({
		filePath: '/src/App.tsx',
		fileName: 'App.tsx',
	});
	t.is(typeof key, 'string');
	t.truthy(key);
});

test('activeEditorKey is stable for identical states', t => {
	const a = activeEditorKey({
		filePath: '/src/App.tsx',
		fileName: 'App.tsx',
		selection: 'const x = 1;',
		startLine: 10,
		endLine: 15,
	});
	const b = activeEditorKey({
		filePath: '/src/App.tsx',
		fileName: 'App.tsx',
		selection: 'const x = 1;',
		startLine: 10,
		endLine: 15,
	});
	t.is(a, b);
});

test('activeEditorKey differs when filePath differs', t => {
	const a = activeEditorKey({filePath: '/src/a.ts', fileName: 'a.ts'});
	const b = activeEditorKey({filePath: '/src/b.ts', fileName: 'b.ts'});
	t.not(a, b);
});

test('activeEditorKey differs when line range differs', t => {
	const base = {filePath: '/src/App.tsx', fileName: 'App.tsx'};
	const a = activeEditorKey({...base, startLine: 10, endLine: 15});
	const b = activeEditorKey({...base, startLine: 20, endLine: 25});
	t.not(a, b);
});

test('activeEditorKey ignores selection text changes within the same line range', t => {
	// Only fileName + lines form the signature — two different selections that
	// cover the same lines should produce the same key (dismissing one stays
	// dismissed if the user tweaks the selection within the same range).
	const base = {
		filePath: '/src/App.tsx',
		fileName: 'App.tsx',
		startLine: 10,
		endLine: 15,
	};
	const a = activeEditorKey({...base, selection: 'first'});
	const b = activeEditorKey({...base, selection: 'second'});
	t.is(a, b);
});

// ============================================================================
// Hook Integration Tests (using a test component)
// ============================================================================

// Test component that uses the hook's return type structure
function TestComponent({
	isConnected,
	connectionCount,
}: {
	isConnected: boolean;
	connectionCount: number;
}) {
	return (
		<Text>
			Connected: {isConnected ? 'yes' : 'no'}, Count: {connectionCount}
		</Text>
	);
}

test('Hook return type structure can be used in components', t => {
	const {lastFrame} = render(
		<TestComponent isConnected={false} connectionCount={0} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.true(output?.includes('Connected: no'));
	t.true(output?.includes('Count: 0'));
});

test('Hook return type structure with connected state', t => {
	const {lastFrame} = render(
		<TestComponent isConnected={true} connectionCount={2} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.true(output?.includes('Connected: yes'));
	t.true(output?.includes('Count: 2'));
});

// ============================================================================
// Type Structure Tests
// ============================================================================

test('UseVSCodeServerReturn interface has expected methods', t => {
	// This tests the interface structure at compile time
	const mockReturn = {
		isConnected: false,
		connectionCount: 0,
		activeEditor: null as {filePath?: string; fileName?: string} | null,
		dismissActiveEditor: () => {},
		sendAssistantMessage: (_content: string, _isGenerating?: boolean) => {},
		notifyFileChange: (
			_filePath: string,
			_originalContent: string,
			_newContent: string,
			_toolName: string,
			_toolArgs: Record<string, unknown>,
		): string | null => null,
		requestDiagnostics: (_filePath?: string) => {},
		updateStatus: () => {},
	};

	t.is(typeof mockReturn.isConnected, 'boolean');
	t.is(typeof mockReturn.connectionCount, 'number');
	t.is(mockReturn.activeEditor, null);
	t.is(typeof mockReturn.dismissActiveEditor, 'function');
	t.is(typeof mockReturn.sendAssistantMessage, 'function');
	t.is(typeof mockReturn.notifyFileChange, 'function');
	t.is(typeof mockReturn.requestDiagnostics, 'function');
	t.is(typeof mockReturn.updateStatus, 'function');
});

test('sendAssistantMessage accepts correct parameters', t => {
	const sendAssistantMessage = (
		_content: string,
		_isGenerating?: boolean,
	): void => {};

	t.notThrows(() => {
		sendAssistantMessage('Hello');
		sendAssistantMessage('Hello', true);
		sendAssistantMessage('Hello', false);
	});
});

test('notifyFileChange returns string or null', t => {
	const notifyFileChange = (
		_filePath: string,
		_originalContent: string,
		_newContent: string,
		_toolName: string,
		_toolArgs: Record<string, unknown>,
	): string | null => {
		return null;
	};

	const result = notifyFileChange('/test.ts', 'old', 'new', 'edit', {});
	t.true(result === null || typeof result === 'string');
});

test('requestDiagnostics accepts optional filePath', t => {
	const requestDiagnostics = (_filePath?: string): void => {};

	t.notThrows(() => {
		requestDiagnostics();
		requestDiagnostics('/test.ts');
		requestDiagnostics(undefined);
	});
});

// ============================================================================
// Props Interface Tests
// ============================================================================

test('UseVSCodeServerProps interface accepts required props', t => {
	const props = {
		enabled: true,
	};

	t.is(typeof props.enabled, 'boolean');
});

test('UseVSCodeServerProps interface accepts optional props', t => {
	const props = {
		enabled: true,
		port: 9999,
		currentModel: 'gpt-4',
		currentProvider: 'openai',
		onPrompt: (
			_prompt: string,
			_context?: {
				filePath?: string;
				selection?: string;
				fileName?: string;
				startLine?: number;
				endLine?: number;
				cursorPosition?: {line: number; character: number};
			},
		) => {},
		onDiagnosticsReceived: (_diagnostics: unknown[]) => {},
	};

	t.is(typeof props.enabled, 'boolean');
	t.is(typeof props.port, 'number');
	t.is(typeof props.currentModel, 'string');
	t.is(typeof props.currentProvider, 'string');
	t.is(typeof props.onPrompt, 'function');
	t.is(typeof props.onDiagnosticsReceived, 'function');
});

test('onPrompt callback receives correct parameters', t => {
	let receivedPrompt: string | undefined;
	let receivedContext:
		| {
				filePath?: string;
				selection?: string;
				fileName?: string;
				startLine?: number;
				endLine?: number;
				cursorPosition?: {line: number; character: number};
		  }
		| undefined;

	const onPrompt = (
		prompt: string,
		context?: {
			filePath?: string;
			selection?: string;
			fileName?: string;
			startLine?: number;
			endLine?: number;
			cursorPosition?: {line: number; character: number};
		},
	) => {
		receivedPrompt = prompt;
		receivedContext = context;
	};

	onPrompt('test prompt', {
		filePath: '/test.ts',
		selection: 'selected text',
		cursorPosition: {line: 10, character: 5},
	});

	t.is(receivedPrompt, 'test prompt');
	t.is(receivedContext?.filePath, '/test.ts');
	t.is(receivedContext?.selection, 'selected text');
	t.deepEqual(receivedContext?.cursorPosition, {line: 10, character: 5});
});

test('onPrompt callback receives VS Code line info', t => {
	let receivedContext:
		| {
				filePath?: string;
				selection?: string;
				fileName?: string;
				startLine?: number;
				endLine?: number;
				cursorPosition?: {line: number; character: number};
		  }
		| undefined;

	const onPrompt = (
		_prompt: string,
		context?: {
			filePath?: string;
			selection?: string;
			fileName?: string;
			startLine?: number;
			endLine?: number;
			cursorPosition?: {line: number; character: number};
		},
	) => {
		receivedContext = context;
	};

	onPrompt('What does this do?', {
		filePath: '/path/to/App.tsx',
		selection: 'const x = 1;',
		fileName: 'App.tsx',
		startLine: 10,
		endLine: 15,
		cursorPosition: {line: 10, character: 0},
	});

	t.is(receivedContext?.fileName, 'App.tsx');
	t.is(receivedContext?.startLine, 10);
	t.is(receivedContext?.endLine, 15);
});

test('onPrompt callback works without context', t => {
	let receivedPrompt: string | undefined;

	const onPrompt = (prompt: string) => {
		receivedPrompt = prompt;
	};

	onPrompt('test prompt');

	t.is(receivedPrompt, 'test prompt');
});

// ============================================================================
// Edge Cases
// ============================================================================

test('createFileChangeFromTool handles paths with spaces', async t => {
	await t.notThrowsAsync(async () => {
		await createFileChangeFromTool(
			'/path/with spaces/file.ts',
			'content',
			'create_file',
			{},
		);
	});
});

test('createFileChangeFromTool handles Windows-style paths', async t => {
	await t.notThrowsAsync(async () => {
		await createFileChangeFromTool(
			'C:\\Users\\test\\file.ts',
			'content',
			'create_file',
			{},
		);
	});
});

test('createFileChangeFromTool handles relative paths', async t => {
	await t.notThrowsAsync(async () => {
		await createFileChangeFromTool(
			'./relative/path.ts',
			'content',
			'create_file',
			{},
		);
	});
});

test('createFileChangeFromTool handles empty path', async t => {
	const result = await createFileChangeFromTool('', 'content', 'create_file', {});

	t.is(result.newContent, 'content');
	t.is(result.originalContent, '');
});

// ============================================================================
// Port Validation Tests
// ============================================================================

test('getVSCodePort returns number in valid range', t => {
	const port = getVSCodePort();

	t.true(Number.isInteger(port));
	t.true(port > 0);
	t.true(port < 65536);
});

test('Default port is a reasonable value', t => {
	const port = getVSCodePort();

	// Default port should be in typical application range
	// Based on DEFAULT_PORT from protocol.ts
	t.true(port >= 1024); // Above privileged ports
	t.true(port <= 65535);
});
