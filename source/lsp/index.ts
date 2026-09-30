/**
 * LSP Integration Module
 *
 * Provides Language Server Protocol support for Nanocoder:
 * - Auto-discovery of installed language servers
 * - Multi-language support with routing
 * - Diagnostics, completions, code actions, and formatting
 */

export {getLSPManager, type LSPInitResult} from './lsp-manager';

export {DiagnosticSeverity} from './protocol';
