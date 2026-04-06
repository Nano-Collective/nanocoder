import {constants} from 'node:fs';
import {access} from 'node:fs/promises';
import {resolve as resolvePath} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {TIMEOUT_LSP_DIAGNOSTICS_MS} from '@/constants';
import {ThemeContext} from '@/hooks/useTheme';
import {DiagnosticSeverity, getLSPManager} from '@/lsp/index';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {type DiagnosticInfo, getVSCodeServer} from '@/vscode/index';

interface GetDiagnosticsArgs {
	path?: string;
}

// Request diagnostics from VS Code with timeout
async function getVSCodeDiagnostics(
	filePath?: string,
): Promise<DiagnosticInfo[] | null> {
	const server = await getVSCodeServer();

	// Convert to absolute path for VS Code
	const absPath = filePath ? resolvePath(filePath) : undefined;

	return new Promise(resolve => {
		const timeout = setTimeout(() => {
			resolve(null);
		}, TIMEOUT_LSP_DIAGNOSTICS_MS);

		// Register callback for this specific request
		server.onCallbacks({
			onDiagnosticsResponse: diagnostics => {
				clearTimeout(timeout);
				resolve(diagnostics);
			},
		});

		server.requestDiagnostics(absPath);
	});
}

// Format VS Code diagnostics to string
function formatVSCodeDiagnostics(
	diagnostics: DiagnosticInfo[],
	filePath?: string,
): string {
	if (diagnostics.length === 0) {
		return filePath
			? `No diagnostics found for ${filePath}`
			: 'No diagnostics found.';
	}

	// Group by file
	const byFile = new Map<string, DiagnosticInfo[]>();
	for (const diag of diagnostics) {
		const path = diag.filePath;
		if (!byFile.has(path)) {
			byFile.set(path, []);
		}
		const fileDiagnostics = byFile.get(path);
		if (fileDiagnostics) {
			fileDiagnostics.push(diag);
		}
	}

	const lines: string[] = [];

	if (filePath) {
		lines.push(`Diagnostics for ${filePath} (from VS Code):`);
		lines.push('');
	} else {
		lines.push('Diagnostics from VS Code:');
		lines.push('');
	}

	for (const [file, fileDiags] of byFile) {
		if (!filePath) {
			lines.push(`\n${file}:`);
		}

		for (const diag of fileDiags) {
			const severity = diag.severity.toUpperCase();
			const line = diag.line + 1;
			const char = diag.character + 1;
			const source = diag.source ? `[${diag.source}] ` : '';
			const prefix = filePath ? '' : '  ';

			lines.push(
				`${prefix}${severity} at line ${line}:${char}: ${source}${diag.message}`,
			);
		}
	}

	return lines.join('\n');
}

// Handler function
const executeGetDiagnostics = async (
	args: GetDiagnosticsArgs,
): Promise<string> => {
	// Prefer VS Code diagnostics when connected
	const server = await getVSCodeServer();
	const hasConnections = server.hasConnections();

	if (hasConnections) {
		const vscodeDiags = await getVSCodeDiagnostics(args.path);
		if (vscodeDiags !== null) {
			return formatVSCodeDiagnostics(vscodeDiags, args.path);
		}
		// Fall through to LSP if VS Code request failed
	}

	// Fall back to local LSP
	const lspManager = await getLSPManager();

	if (!lspManager.isInitialized()) {
		return 'No diagnostics source available. Either connect VS Code with --vscode flag, or install a language server.';
	}

	// If path is provided, get diagnostics for that file
	if (args.path) {
		// Check if we have LSP support for this file type
		if (!lspManager.hasLanguageSupport(args.path)) {
			return `No language server available for file type: ${args.path}. Try running with --vscode flag to use VS Code's TypeScript diagnostics.`;
		}

		// Open the document if not already open
		await lspManager.openDocument(args.path);

		// Get diagnostics
		const diagnostics = await lspManager.getDiagnostics(args.path);

		if (diagnostics.length === 0) {
			return `No diagnostics found for ${args.path}`;
		}

		// Format diagnostics
		const lines: string[] = [`Diagnostics for ${args.path}:`, ''];

		for (const diag of diagnostics) {
			const severity =
				diag.severity === DiagnosticSeverity.Error
					? 'ERROR'
					: diag.severity === DiagnosticSeverity.Warning
						? 'WARNING'
						: diag.severity === DiagnosticSeverity.Information
							? 'INFO'
							: 'HINT';

			const line = diag.range.start.line + 1;
			const char = diag.range.start.character + 1;
			const source = diag.source ? `[${diag.source}] ` : '';

			lines.push(
				`${severity} at line ${line}:${char}: ${source}${diag.message}`,
			);
		}

		return lines.join('\n');
	}

	// Get all diagnostics from all open documents
	const allDiagnostics = lspManager.getAllDiagnostics();

	if (allDiagnostics.length === 0) {
		return 'No diagnostics found in any open documents.';
	}

	const lines: string[] = ['Diagnostics from all open documents:', ''];

	for (const {uri, diagnostics} of allDiagnostics) {
		// Convert URI to path
		const path = uri.startsWith('file://') ? uri.slice(7) : uri;
		lines.push(`\n${path}:`);

		for (const diag of diagnostics) {
			const severity =
				diag.severity === DiagnosticSeverity.Error
					? 'ERROR'
					: diag.severity === DiagnosticSeverity.Warning
						? 'WARNING'
						: diag.severity === DiagnosticSeverity.Information
							? 'INFO'
							: 'HINT';

			const line = diag.range.start.line + 1;
			const char = diag.range.start.character + 1;
			const source = diag.source ? `[${diag.source}] ` : '';

			lines.push(
				`  ${severity} at line ${line}:${char}: ${source}${diag.message}`,
			);
		}
	}

	return lines.join('\n');
};

const getDiagnosticsCoreTool = tool({
	description:
		'Get errors and warnings for a file or project from the language server. Returns type errors, linting issues, and other diagnostics. Use this to check for problems before or after making code changes.',
	inputSchema: jsonSchema<GetDiagnosticsArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description:
					'Path to the file to check. If omitted, returns diagnostics for the entire project.',
			},
		},
		required: [],
	}),
	// Low risk: read-only operation, never requires approval
	needsApproval: false,
	execute: async (args, _options) => {
		return await executeGetDiagnostics(args);
	},
});

// Formatter component
const GetDiagnosticsFormatter = React.memo(
	({args, result}: {args: GetDiagnosticsArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error(
				'GetDiagnosticsFormatter must be used within a ThemeProvider',
			);
		}
		const {colors} = themeContext;

		// Count diagnostics from result
		const errorCount = (result?.match(/ERROR/g) || []).length;
		const warningCount = (result?.match(/WARNING/g) || []).length;

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ get_diagnostics</Text>

				{args.path ? (
					<Box>
						<Text color={colors.secondary}>Path: </Text>
						<Text wrap="truncate-end" color={colors.text}>
							{args.path}
						</Text>
					</Box>
				) : (
					<Box>
						<Text color={colors.secondary}>Scope: </Text>
						<Text color={colors.text}>All open documents</Text>
					</Box>
				)}

				{result && (
					<Box>
						<Text color={colors.secondary}>Found: </Text>
						<Text color={errorCount > 0 ? colors.error : colors.text}>
							{errorCount} errors
						</Text>
						<Text color={colors.secondary}>, </Text>
						<Text color={warningCount > 0 ? colors.warning : colors.text}>
							{warningCount} warnings
						</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const getDiagnosticsFormatter = (
	args: GetDiagnosticsArgs,
	result?: string,
): React.ReactElement => {
	return <GetDiagnosticsFormatter args={args} result={result} />;
};

const getDiagnosticsValidator = async (
	args: GetDiagnosticsArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	// If no path is provided, we're getting diagnostics for all open documents - always valid
	if (!args.path) {
		return {valid: true};
	}

	// Validate that the file exists
	const absPath = resolvePath(args.path);

	try {
		await access(absPath, constants.F_OK);
		return {valid: true};
	} catch (error: unknown) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			return {
				valid: false,
				error: `Error: File "${args.path}" does not exist. Please verify the file path and try again.`,
			};
		}
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			valid: false,
			error: `Error: Cannot access file "${args.path}": ${errorMessage}`,
		};
	}
};

export const getDiagnosticsTool: NanocoderToolExport = {
	name: 'lsp_get_diagnostics' as const,
	tool: getDiagnosticsCoreTool,
	formatter: getDiagnosticsFormatter,
	validator: getDiagnosticsValidator,
	readOnly: true,
};
