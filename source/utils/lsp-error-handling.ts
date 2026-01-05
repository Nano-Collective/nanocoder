/**
 * LSP Tool Error Handling Utilities
 *
 * Centralized error handling for LSP tool execute functions.
 */

import type {
	DiagnosticSeverity,
	PublishDiagnosticsParams,
} from '@/lsp/protocol';

/**
 * Converts an error to a standardized error message with actionable suggestions.
 *
 * @param error - Error object or unknown value
 * @returns Formatted error message with "Error: " prefix and actionable suggestions
 */
export function toolErrorToString(error: unknown): string {
	if (error instanceof Error) {
		let message = `Error: ${error.message}`;

		// Add actionable suggestions for common LSP errors
		if (error.message.includes('Content modified')) {
			message +=
				'\n\n💡 Suggestion: The file has been modified. Try reading the file again to get the latest content.';
		} else if (
			error.message.includes('Language client') ||
			error.message.includes('not initialized')
		) {
			message +=
				'\n\n💡 Suggestion: Start nanocoder with the --lsp flag or connect via VS Code extension.';
		} else if (
			error.message.includes('Cannot find') ||
			error.message.includes('not found')
		) {
			message +=
				'\n\n💡 Suggestion: Verify the symbol exists in the codebase and LSP has indexed the file.';
		} else if (error.message.includes('connection')) {
			message +=
				'\n\n💡 Suggestion: Check if the LSP server is running. Try restarting nanocoder with --lsp.';
		}

		return message;
	}
	return `Error: ${String(error)}`;
}

/**
 * Wraps an async function with standardized error handling.
 * Catches errors and converts them to error message strings.
 *
 * @param fn - Async function to execute
 * @returns Promise resolving to either the result or an error message
 *
 * @example
 * const result = await executeToolWithErrorHandling(async () => {
 *   const lspManager = await requireLSPInitialized();
 *   return await lspManager.getDocumentSymbols(path);
 * });
 */
export async function executeToolWithErrorHandling<T>(
	fn: () => Promise<T>,
): Promise<string | T> {
	try {
		return await fn();
	} catch (error) {
		return toolErrorToString(error);
	}
}

/**
 * Checks if LSP manager is initialized and returns appropriate error message if not.
 *
 * @param isInitialized - Whether LSP manager is initialized
 * @returns Error message string if not initialized, or null if initialized
 */
export function checkLSPInitialized(isInitialized: boolean): string | null {
	if (!isInitialized) {
		return 'Error: LSP not initialized. Start nanocoder with --lsp or connect VS Code.';
	}
	return null;
}

/**
 * Formats diagnostic severity to human-readable string.
 *
 * @param severity - LSP diagnostic severity
 * @returns Human-readable severity level
 */
export function formatDiagnosticSeverity(
	severity?: DiagnosticSeverity,
): string {
	if (severity === undefined) {
		return 'HINT';
	}

	switch (severity) {
		case 1:
			return 'ERROR';
		case 2:
			return 'WARNING';
		case 3:
			return 'INFO';
		case 4:
			return 'HINT';
		default:
			return 'UNKNOWN';
	}
}

/**
 * Formats LSP diagnostics for display.
 *
 * @param diagnostics - Array of LSP diagnostics
 * @param filePath - Optional file path for context
 * @returns Formatted diagnostic messages
 */
export function formatDiagnostics(
	diagnostics: PublishDiagnosticsParams[],
	filePath?: string,
): string {
	const lines: string[] = [];

	if (filePath) {
		lines.push(`Diagnostics for ${filePath}:`);
	} else {
		lines.push('Diagnostics:');
	}

	lines.push('');

	for (const {uri, diagnostics: diags} of diagnostics) {
		const path = uri.startsWith('file://') ? uri.slice(7) : uri;
		if (filePath) {
			lines.push(path);
		} else {
			lines.push(`\n${path}:`);
		}

		for (const diag of diags) {
			const severity = formatDiagnosticSeverity(diag.severity);
			const line = diag.range.start.line + 1;
			const char = diag.range.start.character + 1;
			const source = diag.source ? `[${diag.source}] ` : '';

			lines.push(
				`  ${severity} at line ${line}:${char}: ${source}${diag.message}`,
			);
		}
	}

	return lines.join('\n');
}
