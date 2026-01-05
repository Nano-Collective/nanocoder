/**
 * LSP Protocol types and constants
 * Based on the Language Server Protocol specification
 */

// JSON-RPC message types
export interface JsonRpcMessage {
	jsonrpc: '2.0';
}

export interface JsonRpcRequest extends JsonRpcMessage {
	id: number | string;
	method: string;
	params?: unknown;
}

export interface JsonRpcResponse extends JsonRpcMessage {
	id: number | string | null;
	result?: unknown;
	error?: JsonRpcError;
}

export interface JsonRpcNotification extends JsonRpcMessage {
	method: string;
	params?: unknown;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

// LSP Initialize params
export interface InitializeParams {
	processId: number | null;
	rootUri: string | null;
	capabilities: ClientCapabilities;
	workspaceFolders?: WorkspaceFolder[] | null;
}

export interface ClientCapabilities {
	textDocument?: TextDocumentClientCapabilities;
	workspace?: WorkspaceClientCapabilities;
}

export interface TextDocumentClientCapabilities {
	synchronization?: {
		dynamicRegistration?: boolean;
		willSave?: boolean;
		willSaveWaitUntil?: boolean;
		didSave?: boolean;
	};
	completion?: {
		dynamicRegistration?: boolean;
		completionItem?: {
			snippetSupport?: boolean;
			commitCharactersSupport?: boolean;
			documentationFormat?: string[];
			deprecatedSupport?: boolean;
		};
	};
	hover?: {
		dynamicRegistration?: boolean;
		contentFormat?: string[];
	};
	publishDiagnostics?: {
		relatedInformation?: boolean;
		tagSupport?: {valueSet?: number[]};
		versionSupport?: boolean;
	};
	codeAction?: {
		dynamicRegistration?: boolean;
		codeActionLiteralSupport?: {
			codeActionKind?: {valueSet?: string[]};
		};
	};
	formatting?: {
		dynamicRegistration?: boolean;
	};
}

export interface WorkspaceClientCapabilities {
	applyEdit?: boolean;
	workspaceEdit?: {
		documentChanges?: boolean;
	};
	didChangeConfiguration?: {
		dynamicRegistration?: boolean;
	};
	workspaceFolders?: boolean;
}

export interface WorkspaceFolder {
	uri: string;
	name: string;
}

// LSP Initialize result
export interface InitializeResult {
	capabilities: ServerCapabilities;
	serverInfo?: {
		name: string;
		version?: string;
	};
}

export interface ServerCapabilities {
	textDocumentSync?: number | TextDocumentSyncOptions;
	completionProvider?: CompletionOptions;
	hoverProvider?: boolean;
	definitionProvider?: boolean;
	referencesProvider?: boolean;
	documentFormattingProvider?: boolean;
	codeActionProvider?: boolean | CodeActionOptions;
	diagnosticProvider?: DiagnosticOptions;
}

export interface TextDocumentSyncOptions {
	openClose?: boolean;
	change?: number; // 0 = None, 1 = Full, 2 = Incremental
	save?: boolean | {includeText?: boolean};
}

export interface CompletionOptions {
	triggerCharacters?: string[];
	resolveProvider?: boolean;
}

export interface CodeActionOptions {
	codeActionKinds?: string[];
	resolveProvider?: boolean;
}

export interface DiagnosticOptions {
	identifier?: string;
	interFileDependencies?: boolean;
	workspaceDiagnostics?: boolean;
}

// LSP Diagnostic
export interface Diagnostic {
	range: Range;
	severity?: DiagnosticSeverity;
	code?: number | string;
	source?: string;
	message: string;
	relatedInformation?: DiagnosticRelatedInformation[];
}

export enum DiagnosticSeverity {
	Error = 1,
	Warning = 2,
	Information = 3,
	Hint = 4,
}

export interface DiagnosticRelatedInformation {
	location: Location;
	message: string;
}

// LSP Position and Range
export interface Position {
	line: number;
	character: number;
}

export interface Range {
	start: Position;
	end: Position;
}

export interface Location {
	uri: string;
	range: Range;
}

// LSP Text Document
export interface TextDocumentIdentifier {
	uri: string;
}

export interface VersionedTextDocumentIdentifier
	extends TextDocumentIdentifier {
	version: number;
}

export interface TextDocumentItem {
	uri: string;
	languageId: string;
	version: number;
	text: string;
}

export enum CompletionTriggerKind {
	Invoked = 1,
	TriggerCharacter = 2,
	TriggerForIncompleteCompletions = 3,
}

export interface CompletionItem {
	label: string;
	kind?: CompletionItemKind;
	detail?: string;
	documentation?: string | MarkupContent;
	deprecated?: boolean;
	insertText?: string;
	insertTextFormat?: InsertTextFormat;
	textEdit?: TextEdit;
	additionalTextEdits?: TextEdit[];
}

export enum CompletionItemKind {
	Text = 1,
	Method = 2,
	Function = 3,
	Constructor = 4,
	Field = 5,
	Variable = 6,
	Class = 7,
	Interface = 8,
	Module = 9,
	Property = 10,
	Keyword = 14,
	Snippet = 15,
	TypeParameter = 25,
}

export enum InsertTextFormat {
	PlainText = 1,
	Snippet = 2,
}

export interface CompletionList {
	isIncomplete: boolean;
	items: CompletionItem[];
}

export interface MarkupContent {
	kind: 'plaintext' | 'markdown';
	value: string;
}

// LSP Code Action
export interface CodeActionParams {
	textDocument: TextDocumentIdentifier;
	range: Range;
	context: CodeActionContext;
}

export interface CodeActionContext {
	diagnostics: Diagnostic[];
	only?: string[];
}

export interface CodeAction {
	title: string;
	kind?: string;
	diagnostics?: Diagnostic[];
	isPreferred?: boolean;
	edit?: WorkspaceEdit;
	command?: Command;
}

export interface Command {
	title: string;
	command: string;
	arguments?: unknown[];
}

/**
 * Symbol Kind Enumeration
 */
export enum SymbolKind {
	File = 1,
	Module = 2,
	Namespace = 3,
	Package = 4,
	Class = 5,
	Method = 6,
	Property = 7,
	Field = 8,
	Constructor = 9,
	Enum = 10,
	Interface = 11,
	Function = 12,
	Variable = 13,
	Constant = 14,
	String = 15,
	Number = 16,
	Boolean = 17,
	Array = 18,
	Object = 19,
	Key = 20,
	Null = 21,
	EnumMember = 22,
	Struct = 23,
	Event = 24,
	Operator = 25,
	TypeParameter = 26,
}

/**
 * Document Symbol
 */
export interface DocumentSymbol {
	name: string;
	detail?: string;
	kind: SymbolKind;
	range: Range;
	selectionRange: Range;
	children?: DocumentSymbol[];
	deprecated?: boolean;
}

/**
 * Symbol Information
 */
export interface SymbolInformation {
	name: string;
	kind: SymbolKind;
	location: Location;
	containerName?: string;
	deprecated?: boolean;
}

/**
 * Document Symbol Params
 */
export interface DocumentSymbolParams {
	textDocument: TextDocumentIdentifier;
}

/**
 * Rename Params
 */
export interface RenameParams {
	textDocument: TextDocumentIdentifier;
	position: Position;
	newName: string;
}

/**
 * Rename Options
 */
export interface RenameOptions {
	prepareProvider?: boolean;
}

export interface WorkspaceEdit {
	changes?: {[uri: string]: TextEdit[]};
	documentChanges?: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[];
}

export interface TextEdit {
	range: Range;
	newText: string;
}

export interface TextDocumentEdit {
	textDocument: VersionedTextDocumentIdentifier;
	edits: TextEdit[];
}

export interface CreateFile {
	kind: 'create';
	uri: string;
	options?: {overwrite?: boolean; ignoreIfExists?: boolean};
}

export interface RenameFile {
	kind: 'rename';
	oldUri: string;
	newUri: string;
	options?: {overwrite?: boolean; ignoreIfExists?: boolean};
}

export interface DeleteFile {
	kind: 'delete';
	uri: string;
	options?: {recursive?: boolean; ignoreIfNotExists?: boolean};
}

// LSP Formatting
export interface DocumentFormattingParams {
	textDocument: TextDocumentIdentifier;
	options: FormattingOptions;
}

export interface FormattingOptions {
	tabSize: number;
	insertSpaces: boolean;
	trimTrailingWhitespace?: boolean;
	insertFinalNewline?: boolean;
	trimFinalNewlines?: boolean;
}

// LSP Publish Diagnostics
export interface PublishDiagnosticsParams {
	uri: string;
	version?: number;
	diagnostics: Diagnostic[];
}

// LSP Methods
export const LSPMethods = {
	// Lifecycle
	Initialize: 'initialize',
	Initialized: 'initialized',
	Shutdown: 'shutdown',
	Exit: 'exit',

	// Text Document
	DidOpen: 'textDocument/didOpen',
	DidChange: 'textDocument/didChange',
	DidClose: 'textDocument/didClose',
	DidSave: 'textDocument/didSave',

	// Language Features
	Completion: 'textDocument/completion',
	Hover: 'textDocument/hover',
	Definition: 'textDocument/definition',
	References: 'textDocument/references',
	DocumentSymbol: 'textDocument/documentSymbol',
	Rename: 'textDocument/rename',
	CodeAction: 'textDocument/codeAction',
	Formatting: 'textDocument/formatting',

	// Diagnostics
	PublishDiagnostics: 'textDocument/publishDiagnostics',
	DocumentDiagnostic: 'textDocument/diagnostic',
	WorkspaceDiagnostic: 'workspace/diagnostic',
} as const;

// Text Document Sync Kind
export enum TextDocumentSyncKind {
	None = 0,
	Full = 1,
	Incremental = 2,
}
