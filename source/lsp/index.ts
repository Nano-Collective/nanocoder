/**
 * LSP Integration Module
 *
 * Provides Language Server Protocol support for Nanocoder:
 * - Auto-discovery of installed language servers
 * - Multi-language support with routing
 * - Diagnostics, completions, code actions, and formatting
 */

export {type LSPServerConfig} from './lsp-client';

export {
	type DiagnosticsResult,
	getLSPManager,
	type LSPInitResult,
	type LSPManagerConfig,
} from './lsp-manager';

export {
	type CodeAction,
	type CompletionItem,
	type Diagnostic,
	DiagnosticSeverity,
	type DocumentSymbol,
	type DocumentSymbolParams,
	type FormattingOptions,
	type Location,
	type Position,
	type PublishDiagnosticsParams,
	type Range,
	type RenameOptions,
	type RenameParams,
	type SymbolInformation,
	SymbolKind,
	type TextEdit,
	type WorkspaceEdit,
} from './protocol';
