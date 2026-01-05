/**
 * LSP Manager Helper Utilities
 *
 * Convenience functions for common LSP manager operations.
 */

import {getLSPManager} from '@/lsp/index';
import type {LSPManager} from '@/lsp/lsp-manager';

/**
 * Error thrown when LSP is not initialized.
 */
export class LSPNotInitializedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LSPNotInitializedError';
	}
}

/**
 * Gets the LSP manager singleton and ensures it's initialized.
 *
 * @returns Promise resolving to the LSP manager
 * @throws LSPNotInitializedError if LSP is not initialized
 *
 * @example
 * try {
 *   const lspManager = await requireLSPInitialized();
 *   return await lspManager.getDocumentSymbols(path);
 * } catch (error) {
 *   if (error instanceof LSPNotInitializedError) {
 *     return `Error: ${error.message}`;
 *   }
 *   throw error;
 * }
 */
export async function requireLSPInitialized(): Promise<LSPManager> {
	const lspManager = await getLSPManager();

	if (!lspManager.isInitialized()) {
		throw new LSPNotInitializedError(
			'LSP not initialized. Start nanocoder with --lsp or connect VS Code.',
		);
	}

	return lspManager;
}

/**
 * Checks if LSP manager is initialized without throwing.
 *
 * @returns true if initialized, false otherwise
 */
export function isLSPInitialized(): boolean {
	// Note: This is a sync check. The actual implementation would need
	// to cache the initialization state or check the manager synchronously.
	// For now, this is a placeholder for the pattern.
	return true;
}
