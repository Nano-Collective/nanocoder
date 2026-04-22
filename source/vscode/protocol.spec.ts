import test from 'ava';
import {DEFAULT_PORT, PROTOCOL_VERSION} from './protocol.js';
import type {
	ActiveEditorMessage,
	ApplyChangeMessage,
	AssistantMessage,
	ClientMessage,
	ConnectionAckMessage,
	ContextMessage,
	DiagnosticInfo,
	DiagnosticsRequestMessage,
	DiagnosticsResponseMessage,
	FileChangeMessage,
	GetStatusMessage,
	PendingChange,
	RejectChangeMessage,
	SendPromptMessage,
	ServerMessage,
	StatusMessage,
	ToolCallMessage,
} from './protocol.js';

// ============================================================================
// Tests for protocol constants
// ============================================================================

test('PROTOCOL_VERSION is defined and is a valid semver string', t => {
	t.truthy(PROTOCOL_VERSION);
	t.regex(PROTOCOL_VERSION, /^\d+\.\d+\.\d+$/);
});

test('DEFAULT_PORT is defined and is a valid port number', t => {
	t.truthy(DEFAULT_PORT);
	t.true(DEFAULT_PORT > 0 && DEFAULT_PORT < 65536);
	t.is(DEFAULT_PORT, 51820);
});

// ============================================================================
// Tests for ServerMessage types
// ============================================================================

test('FileChangeMessage has correct structure', t => {
	const message: FileChangeMessage = {
		type: 'file_change',
		id: 'test-id',
		filePath: '/path/to/file.ts',
		originalContent: 'original',
		newContent: 'new',
		toolName: 'create_file',
		toolArgs: {path: '/path/to/file.ts'},
	};

	t.is(message.type, 'file_change');
	t.is(message.id, 'test-id');
	t.is(message.filePath, '/path/to/file.ts');
	t.is(message.originalContent, 'original');
	t.is(message.newContent, 'new');
	t.is(message.toolName, 'create_file');
	t.deepEqual(message.toolArgs, {path: '/path/to/file.ts'});
});

test('ToolCallMessage has correct structure', t => {
	const message: ToolCallMessage = {
		type: 'tool_call',
		id: 'tool-id',
		toolName: 'execute_bash',
		toolArgs: {command: 'ls -la'},
		status: 'pending',
	};

	t.is(message.type, 'tool_call');
	t.is(message.id, 'tool-id');
	t.is(message.toolName, 'execute_bash');
	t.is(message.status, 'pending');
});

test('ToolCallMessage supports all status values', t => {
	const statuses: ToolCallMessage['status'][] = [
		'pending',
		'executing',
		'completed',
		'rejected',
	];

	for (const status of statuses) {
		const message: ToolCallMessage = {
			type: 'tool_call',
			id: 'tool-id',
			toolName: 'test',
			toolArgs: {},
			status,
		};
		t.is(message.status, status);
	}
});

test('ToolCallMessage can include result', t => {
	const message: ToolCallMessage = {
		type: 'tool_call',
		id: 'tool-id',
		toolName: 'execute_bash',
		toolArgs: {command: 'echo hello'},
		status: 'completed',
		result: 'hello\n',
	};

	t.is(message.result, 'hello\n');
});

test('AssistantMessage has correct structure', t => {
	const message: AssistantMessage = {
		type: 'assistant_message',
		content: 'Hello, I can help you with that.',
		isGenerating: false,
	};

	t.is(message.type, 'assistant_message');
	t.is(message.content, 'Hello, I can help you with that.');
	t.false(message.isGenerating);
});

test('AssistantMessage can be streaming', t => {
	const message: AssistantMessage = {
		type: 'assistant_message',
		content: 'Partial response...',
		isGenerating: true,
	};

	t.true(message.isGenerating);
});

test('StatusMessage has correct structure', t => {
	const message: StatusMessage = {
		type: 'status',
		connected: true,
		model: 'gpt-4',
		provider: 'openai',
		workingDirectory: '/home/user/project',
	};

	t.is(message.type, 'status');
	t.true(message.connected);
	t.is(message.model, 'gpt-4');
	t.is(message.provider, 'openai');
	t.is(message.workingDirectory, '/home/user/project');
});

test('StatusMessage optional fields can be omitted', t => {
	const message: StatusMessage = {
		type: 'status',
		connected: false,
	};

	t.is(message.type, 'status');
	t.false(message.connected);
	t.is(message.model, undefined);
	t.is(message.provider, undefined);
	t.is(message.workingDirectory, undefined);
});

test('ConnectionAckMessage has correct structure', t => {
	const message: ConnectionAckMessage = {
		type: 'connection_ack',
		protocolVersion: '1.0.0',
		cliVersion: '1.16.0',
	};

	t.is(message.type, 'connection_ack');
	t.is(message.protocolVersion, '1.0.0');
	t.is(message.cliVersion, '1.16.0');
});

test('DiagnosticsRequestMessage has correct structure', t => {
	const message: DiagnosticsRequestMessage = {
		type: 'diagnostics_request',
		filePath: '/path/to/file.ts',
	};

	t.is(message.type, 'diagnostics_request');
	t.is(message.filePath, '/path/to/file.ts');
});

test('DiagnosticsRequestMessage filePath is optional', t => {
	const message: DiagnosticsRequestMessage = {
		type: 'diagnostics_request',
	};

	t.is(message.type, 'diagnostics_request');
	t.is(message.filePath, undefined);
});

// ============================================================================
// Tests for ClientMessage types
// ============================================================================

test('SendPromptMessage has correct structure', t => {
	const message: SendPromptMessage = {
		type: 'send_prompt',
		prompt: 'Help me refactor this function',
		context: {
			filePath: '/path/to/file.ts',
			selection: 'function foo() {}',
			cursorPosition: {line: 10, character: 5},
		},
	};

	t.is(message.type, 'send_prompt');
	t.is(message.prompt, 'Help me refactor this function');
	t.is(message.context?.filePath, '/path/to/file.ts');
	t.is(message.context?.selection, 'function foo() {}');
	t.deepEqual(message.context?.cursorPosition, {line: 10, character: 5});
});

test('SendPromptMessage context is optional', t => {
	const message: SendPromptMessage = {
		type: 'send_prompt',
		prompt: 'Hello',
	};

	t.is(message.type, 'send_prompt');
	t.is(message.context, undefined);
});

test('SendPromptMessage context includes line info for VS Code selections', t => {
	const message: SendPromptMessage = {
		type: 'send_prompt',
		prompt: 'What does this do?',
		context: {
			filePath: '/path/to/App.tsx',
			selection: 'const x = 1;',
			fileName: 'App.tsx',
			startLine: 10,
			endLine: 15,
			cursorPosition: {line: 10, character: 0},
		},
	};

	t.is(message.type, 'send_prompt');
	t.is(message.prompt, 'What does this do?');
	t.is(message.context?.fileName, 'App.tsx');
	t.is(message.context?.startLine, 10);
	t.is(message.context?.endLine, 15);
	t.is(message.context?.selection, 'const x = 1;');
});

test('SendPromptMessage context line info fields are optional', t => {
	const message: SendPromptMessage = {
		type: 'send_prompt',
		prompt: 'Hello',
		context: {
			filePath: '/path/to/file.ts',
		},
	};

	t.is(message.context?.fileName, undefined);
	t.is(message.context?.startLine, undefined);
	t.is(message.context?.endLine, undefined);
});

test('ApplyChangeMessage has correct structure', t => {
	const message: ApplyChangeMessage = {
		type: 'apply_change',
		id: 'change-123',
	};

	t.is(message.type, 'apply_change');
	t.is(message.id, 'change-123');
});

test('RejectChangeMessage has correct structure', t => {
	const message: RejectChangeMessage = {
		type: 'reject_change',
		id: 'change-123',
	};

	t.is(message.type, 'reject_change');
	t.is(message.id, 'change-123');
});

test('GetStatusMessage has correct structure', t => {
	const message: GetStatusMessage = {
		type: 'get_status',
	};

	t.is(message.type, 'get_status');
});

test('ContextMessage has correct structure', t => {
	const diagnostics: DiagnosticInfo[] = [
		{
			filePath: '/path/to/file.ts',
			line: 10,
			character: 5,
			message: 'Type error',
			severity: 'error',
			source: 'typescript',
		},
	];

	const message: ContextMessage = {
		type: 'context',
		workspaceFolder: '/home/user/project',
		openFiles: ['/home/user/project/src/index.ts'],
		activeFile: '/home/user/project/src/index.ts',
		diagnostics,
	};

	t.is(message.type, 'context');
	t.is(message.workspaceFolder, '/home/user/project');
	t.deepEqual(message.openFiles, ['/home/user/project/src/index.ts']);
	t.is(message.activeFile, '/home/user/project/src/index.ts');
	t.is(message.diagnostics?.length, 1);
});

test('ContextMessage fields are optional', t => {
	const message: ContextMessage = {
		type: 'context',
	};

	t.is(message.type, 'context');
	t.is(message.workspaceFolder, undefined);
	t.is(message.openFiles, undefined);
	t.is(message.activeFile, undefined);
	t.is(message.diagnostics, undefined);
});

test('ActiveEditorMessage has correct structure with a selection', t => {
	const message: ActiveEditorMessage = {
		type: 'active_editor',
		filePath: '/path/to/App.tsx',
		fileName: 'App.tsx',
		selection: 'const x = 1;',
		startLine: 10,
		endLine: 15,
	};

	t.is(message.type, 'active_editor');
	t.is(message.filePath, '/path/to/App.tsx');
	t.is(message.fileName, 'App.tsx');
	t.is(message.selection, 'const x = 1;');
	t.is(message.startLine, 10);
	t.is(message.endLine, 15);
});

test('ActiveEditorMessage can represent a focused file with no selection', t => {
	const message: ActiveEditorMessage = {
		type: 'active_editor',
		filePath: '/path/to/App.tsx',
		fileName: 'App.tsx',
	};

	t.is(message.filePath, '/path/to/App.tsx');
	t.is(message.fileName, 'App.tsx');
	t.is(message.selection, undefined);
	t.is(message.startLine, undefined);
	t.is(message.endLine, undefined);
});

test('ActiveEditorMessage with no filePath represents a cleared state', t => {
	const message: ActiveEditorMessage = {
		type: 'active_editor',
	};

	t.is(message.type, 'active_editor');
	t.is(message.filePath, undefined);
	t.is(message.fileName, undefined);
});

test('DiagnosticsResponseMessage has correct structure', t => {
	const diagnostics: DiagnosticInfo[] = [
		{
			filePath: '/path/to/file.ts',
			line: 5,
			character: 10,
			message: 'Unused variable',
			severity: 'warning',
		},
	];

	const message: DiagnosticsResponseMessage = {
		type: 'diagnostics_response',
		diagnostics,
	};

	t.is(message.type, 'diagnostics_response');
	t.is(message.diagnostics.length, 1);
	t.is(message.diagnostics[0].severity, 'warning');
});

// ============================================================================
// Tests for DiagnosticInfo
// ============================================================================

test('DiagnosticInfo has correct structure', t => {
	const diagnostic: DiagnosticInfo = {
		filePath: '/path/to/file.ts',
		line: 10,
		character: 5,
		message: "Cannot find name 'foo'",
		severity: 'error',
		source: 'typescript',
	};

	t.is(diagnostic.filePath, '/path/to/file.ts');
	t.is(diagnostic.line, 10);
	t.is(diagnostic.character, 5);
	t.is(diagnostic.message, "Cannot find name 'foo'");
	t.is(diagnostic.severity, 'error');
	t.is(diagnostic.source, 'typescript');
});

test('DiagnosticInfo supports all severity levels', t => {
	const severities: DiagnosticInfo['severity'][] = [
		'error',
		'warning',
		'info',
		'hint',
	];

	for (const severity of severities) {
		const diagnostic: DiagnosticInfo = {
			filePath: '/test.ts',
			line: 1,
			character: 1,
			message: 'Test',
			severity,
		};
		t.is(diagnostic.severity, severity);
	}
});

test('DiagnosticInfo source is optional', t => {
	const diagnostic: DiagnosticInfo = {
		filePath: '/test.ts',
		line: 1,
		character: 1,
		message: 'Test',
		severity: 'info',
	};

	t.is(diagnostic.source, undefined);
});

// ============================================================================
// Tests for PendingChange
// ============================================================================

test('PendingChange has correct structure', t => {
	const change: PendingChange = {
		id: 'change-123',
		filePath: '/path/to/file.ts',
		originalContent: 'const x = 1;',
		newContent: 'const x = 2;',
		toolName: 'replace_lines',
		timestamp: Date.now(),
	};

	t.is(change.id, 'change-123');
	t.is(change.filePath, '/path/to/file.ts');
	t.is(change.originalContent, 'const x = 1;');
	t.is(change.newContent, 'const x = 2;');
	t.is(change.toolName, 'replace_lines');
	t.true(change.timestamp > 0);
});

// ============================================================================
// Tests for type unions (compile-time checks)
// ============================================================================

test('ServerMessage type union includes all message types', t => {
	// This test verifies the type union at compile time
	const messages: ServerMessage[] = [
		{
			type: 'file_change',
			id: '1',
			filePath: '/test',
			originalContent: '',
			newContent: '',
			toolName: 'test',
			toolArgs: {},
		},
		{
			type: 'tool_call',
			id: '2',
			toolName: 'test',
			toolArgs: {},
			status: 'pending',
		},
		{type: 'assistant_message', content: 'test', isGenerating: false},
		{type: 'status', connected: true},
		{type: 'connection_ack', protocolVersion: '1.0.0', cliVersion: '1.0.0'},
		{type: 'diagnostics_request'},
	];

	t.is(messages.length, 6);
});

test('ClientMessage type union includes all message types', t => {
	// This test verifies the type union at compile time
	const messages: ClientMessage[] = [
		{type: 'send_prompt', prompt: 'test'},
		{type: 'apply_change', id: '1'},
		{type: 'reject_change', id: '2'},
		{type: 'get_status'},
		{type: 'context'},
		{type: 'diagnostics_response', diagnostics: []},
		{type: 'active_editor'},
	];

	t.is(messages.length, 7);
});
