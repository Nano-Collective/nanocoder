import type {Message, ToolCall, ToolResult} from '@/types/core';

const DIAGNOSTICS_TOOL_NAME = 'lsp_get_diagnostics';
// Keep in sync with edit tools that produce a single changed file path.
const EDIT_TOOL_NAMES = new Set(['write_file', 'string_replace']);
const ACTIONABLE_DIAGNOSTIC_SEVERITIES = new Set(['error', 'warning']);

type ProcessToolUse = (toolCall: ToolCall) => Promise<ToolResult>;
type AutoDiagnosticFinding = {
	path: string;
	result: ToolResult;
};

function parseToolArgs(
	args: ToolCall['function']['arguments'],
): Record<string, unknown> {
	if (typeof args === 'string') {
		try {
			const parsed = JSON.parse(args);
			return parsed && typeof parsed === 'object' ? parsed : {};
		} catch {
			return {};
		}
	}
	return args && typeof args === 'object' ? args : {};
}

function isSuccessfulToolResult(result: ToolResult): boolean {
	return !(
		result.content.startsWith('Error: ') ||
		result.content.startsWith('⚒ Validation failed') ||
		result.content === 'Tool execution was cancelled by the user.'
	);
}

export function collectEditedPaths(
	toolCalls: ToolCall[],
	results: ToolResult[],
): string[] {
	const resultsById = new Map(
		results.map(result => [result.tool_call_id, result]),
	);
	const seen = new Set<string>();
	const paths: string[] = [];

	for (const toolCall of toolCalls) {
		if (!EDIT_TOOL_NAMES.has(toolCall.function.name)) continue;

		const result = resultsById.get(toolCall.id);
		if (!result || !isSuccessfulToolResult(result)) continue;

		const args = parseToolArgs(toolCall.function.arguments);
		const path = args.path ?? args.file_path;
		if (typeof path !== 'string' || path.length === 0 || seen.has(path)) {
			continue;
		}

		seen.add(path);
		paths.push(path);
	}

	return paths;
}

function diagnosticsHaveFindings(result: ToolResult): boolean {
	if (result.name !== DIAGNOSTICS_TOOL_NAME) return true;
	if (result.content.startsWith('Error: ')) return true;

	const structured = result.structuredContent;
	if (
		structured &&
		typeof structured === 'object' &&
		'diagnostics' in structured &&
		Array.isArray(structured.diagnostics)
	) {
		const severities = structured.diagnostics
			.map(diagnostic => {
				if (!diagnostic || typeof diagnostic !== 'object') return null;
				if (!('severity' in diagnostic)) return null;
				return String(diagnostic.severity).toLowerCase();
			})
			.filter((severity): severity is string => severity !== null);
		if (severities.length > 0) {
			return severities.some(severity =>
				ACTIONABLE_DIAGNOSTIC_SEVERITIES.has(severity),
			);
		}
	}

	if (
		result.content.startsWith('No diagnostics found') ||
		result.content.startsWith('No diagnostics source available') ||
		result.content.startsWith('No language server available')
	) {
		return false;
	}

	return /\b(?:ERROR|WARNING)\b/i.test(result.content);
}

function errorContent(error: unknown): string {
	const message =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: 'Unknown diagnostics failure';
	return message.startsWith('Error: ') ? message : `Error: ${message}`;
}

function formatDiagnosticFinding({
	path,
	result,
}: AutoDiagnosticFinding): string {
	const header = `Diagnostics for ${path}:`;
	if (result.name !== DIAGNOSTICS_TOOL_NAME) {
		return `${header}\nAutomatic diagnostics expected ${DIAGNOSTICS_TOOL_NAME} but received ${result.name}:\n${result.content}`;
	}

	if (result.content.startsWith(`Diagnostics for ${path}`)) {
		return result.content;
	}

	return `${header}\n${result.content}`;
}

export async function buildAutoDiagnosticsMessage(
	toolCalls: ToolCall[],
	results: ToolResult[],
	processToolUse: ProcessToolUse,
): Promise<Message | null> {
	const editedPaths = collectEditedPaths(toolCalls, results);
	if (editedPaths.length === 0) return null;

	const diagnosticFindings: AutoDiagnosticFinding[] = [];
	for (const [index, path] of editedPaths.entries()) {
		let result: ToolResult;
		try {
			result = await processToolUse({
				id: `auto_diagnostics_${index + 1}`,
				function: {
					name: DIAGNOSTICS_TOOL_NAME,
					arguments: {path},
				},
			});
		} catch (error) {
			result = {
				tool_call_id: `auto_diagnostics_${index + 1}`,
				role: 'tool',
				name: DIAGNOSTICS_TOOL_NAME,
				content: errorContent(error),
			};
		}

		if (diagnosticsHaveFindings(result)) {
			diagnosticFindings.push({path, result});
		}
	}

	if (diagnosticFindings.length === 0) return null;

	const diagnosticsText = diagnosticFindings
		.map(formatDiagnosticFinding)
		.join('\n\n');
	const pathsNeedingAttentionText = diagnosticFindings
		.map(({path}) => `- ${path}`)
		.join('\n');

	return {
		role: 'user',
		content:
			'Automatic diagnostics after the recent edits found issues. Please fix the diagnostics you introduced before finishing.\n\n' +
			`Paths needing attention:\n${pathsNeedingAttentionText}\n\n` +
			diagnosticsText,
	};
}
