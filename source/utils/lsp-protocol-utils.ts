/**
 * LSP Protocol Utility Functions
 *
 * Helper functions for converting between LSP protocol types and display formats.
 */

import type {
	DocumentSymbol,
	Location,
	Position,
	Range,
	SymbolInformation,
} from '@/lsp/protocol';

/**
 * Converts a file:// URI to a regular file path.
 *
 * @param uri - LSP URI with file:// prefix
 * @returns File path without file:// prefix
 *
 * @example
 * uriToFilePath('file:///home/user/project/src/app.ts')
 * // Returns: '/home/user/project/src/app.ts'
 */
export function uriToFilePath(uri: string): string {
	return uri.replace('file://', '');
}

/**
 * Get the file extension from a path.
 *
 * @param filePath - The file path
 * @returns The file extension (e.g., ".ts") or empty string
 */
export function getFileExtension(filePath: string): string {
	const lastDot = filePath.lastIndexOf('.');
	if (lastDot === -1 || lastDot === filePath.length - 1) {
		return '';
	}
	return filePath.slice(lastDot);
}

/**
 * Detect programming language from file extension.
 *
 * @param filePath - The file path
 * @returns The language name or "Unknown"
 */
export function getFileLanguage(filePath: string): string {
	const ext = getFileExtension(filePath).toLowerCase();

	const languageMap: Record<string, string> = {
		// JavaScript/TypeScript
		'.js': 'JavaScript',
		'.jsx': 'JavaScript (React)',
		'.ts': 'TypeScript',
		'.tsx': 'TypeScript (React)',
		'.mjs': 'JavaScript (ESM)',
		'.cjs': 'JavaScript (CJS)',
		'.mts': 'TypeScript (ESM)',
		'.cts': 'TypeScript (CJS)',

		// Python
		'.py': 'Python',
		'.pyi': 'Python (Stubs)',
		'.pyw': 'Python (Windows)',

		// Web
		'.html': 'HTML',
		'.htm': 'HTML',
		'.css': 'CSS',
		'.scss': 'SCSS',
		'.sass': 'Sass',
		'.less': 'Less',
		'.json': 'JSON',
		'.xml': 'XML',

		// Rust
		'.rs': 'Rust',

		// Go
		'.go': 'Go',

		// Java/Kotlin
		'.java': 'Java',
		'.kt': 'Kotlin',
		'.kts': 'Kotlin Script',

		// C/C++
		'.c': 'C',
		'.h': 'C Header',
		'.cpp': 'C++',
		'.hpp': 'C++ Header',
		'.cc': 'C++',
		'.cxx': 'C++',
		'.hxx': 'C++ Header',

		// C#
		'.cs': 'C#',

		// PHP
		'.php': 'PHP',

		// Ruby
		'.rb': 'Ruby',

		// Swift
		'.swift': 'Swift',

		// Shell
		'.sh': 'Shell',
		'.bash': 'Bash',
		'.zsh': 'Zsh',

		// Markdown/Docs
		'.md': 'Markdown',
		'.mdx': 'Markdown (JSX)',
		'.txt': 'Plain Text',

		// YAML
		'.yml': 'YAML',
		'.yaml': 'YAML',

		// TOML
		'.toml': 'TOML',

		// Config
		'.ini': 'INI',
		'.conf': 'Config',
	};

	return languageMap[ext] || 'Unknown';
}

/**
 * Converts LSP Position (0-indexed) to display format (1-indexed).
 *
 * @param position - LSP position with 0-indexed line and character
 * @returns Display position with 1-indexed line and character
 *
 * @example
 * positionToDisplay({line: 0, character: 5})
 * // Returns: {line: 1, character: 6}
 */
export function positionToDisplay(position: Position): {
	line: number;
	character: number;
} {
	return {
		line: position.line + 1,
		character: position.character + 1,
	};
}

/**
 * Converts LSP Range to display format with 1-indexed positions.
 *
 * @param range - LSP range with 0-indexed positions
 * @returns Display range with 1-indexed positions
 */
export function rangeToDisplayRange(range: Range): {
	startLine: number;
	startChar: number;
	endLine: number;
	endChar: number;
} {
	return {
		startLine: range.start.line + 1,
		startChar: range.start.character + 1,
		endLine: range.end.line + 1,
		endChar: range.end.character + 1,
	};
}

/**
 * Formats a location as a human-readable string.
 *
 * @param location - LSP location
 * @returns Formatted location string (e.g., "src/app.ts:42:7")
 */
export function formatLocation(location: Location): string {
	const filePath = uriToFilePath(location.uri);
	const {line, character} = positionToDisplay(location.range.start);
	return `${filePath}:${line}:${character}`;
}

/**
 * Formats symbol kind enum to human-readable string.
 *
 * @param kind - LSP SymbolKind enum value
 * @returns Human-readable symbol kind name
 */
export function formatSymbolKind(kind: number): string {
	// Import SymbolKind from protocol to get name
	// This is a workaround to avoid circular imports
	const symbolKinds = [
		'File',
		'Module',
		'Namespace',
		'Package',
		'Class',
		'Method',
		'Property',
		'Field',
		'Constructor',
		'Enum',
		'Interface',
		'Function',
		'Variable',
		'Constant',
		'String',
		'Number',
		'Boolean',
		'Array',
		'Object',
		'Key',
		'Null',
		'EnumMember',
		'Struct',
		'Event',
		'Operator',
		'TypeParameter',
	];

	return symbolKinds[kind - 1] || 'Unknown';
}

/**
 * Formats a document symbol or symbol information for display.
 *
 * @param symbol - Either DocumentSymbol or SymbolInformation
 * @param indent - Indentation level for hierarchical display
 * @returns Formatted symbol string
 */
export function formatSymbol(
	symbol: DocumentSymbol | SymbolInformation,
	indent = 0,
): string {
	const prefix = '  '.repeat(indent);
	const kindName = formatSymbolKind(symbol.kind);

	if ('location' in symbol) {
		// SymbolInformation (flat)
		const container = symbol.containerName ? ` in ${symbol.containerName}` : '';
		const location = formatLocation(symbol.location);
		return `${prefix}${kindName}: ${symbol.name}${container} (${location})`;
	} else {
		// DocumentSymbol (hierarchical)
		const detail = symbol.detail ? ` - ${symbol.detail}` : '';
		const {line} = positionToDisplay(symbol.range.start);
		return `${prefix}${kindName}: ${symbol.name}${detail} (line ${line})`;
	}
}
