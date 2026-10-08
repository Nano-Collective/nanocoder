import type {FirewallViolation} from '@/types/firewall';

const TEST_FILE_PATTERN = /\.(spec|test)\.[jt]sx?$/i;

/**
 * Removes comments and string literals to avoid false positives when analyzing syntax.
 */
function stripCommentsAndStrings(code: string): string {
	return code
		.replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length))
		.replace(/\/\/.*$/gm, match => ' '.repeat(match.length))
		.replace(/(["'`])(?:(?=(\\?))\2[\s\S])*?\1/g, match =>
			' '.repeat(match.length),
		);
}

/**
 * Finds all occurrences of explicit `any` type keyword in code.
 */
function findAnyOccurrences(code: string): {count: number; lines: number[]} {
	const lines = code.split('\n');
	const matchedLines: number[] = [];
	let count = 0;

	// Pattern matches : any, as any, <any>, <..., any>, (x: any), etc.
	const anyPattern =
		/(?::\s*any\b|as\s+any\b|<\s*any\s*[>,]|,\s*any\s*[>,]|\bany\s*\[\])/g;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Skip line if it is purely comment or string
		const cleaned = stripCommentsAndStrings(line);
		const matches = cleaned.match(anyPattern);
		if (matches) {
			count += matches.length;
			matchedLines.push(i + 1);
		}
	}

	return {count, lines: matchedLines};
}

/**
 * Detects newly introduced `any` types in TypeScript/JavaScript files.
 */
export function detectAnyTypeInjections(
	filePath: string,
	oldContent: string,
	newContent: string,
): FirewallViolation[] {
	if (!/\.[jt]sx?$/i.test(filePath)) {
		return [];
	}

	const oldOccurrences = findAnyOccurrences(oldContent);
	const newOccurrences = findAnyOccurrences(newContent);

	if (newOccurrences.count > oldOccurrences.count) {
		const addedCount = newOccurrences.count - oldOccurrences.count;
		return [
			{
				rule: 'block_any_types',
				filePath,
				message: `Injected ${addedCount} explicit 'any' type annotation(s).`,
				details: `Found 'any' at line(s): ${newOccurrences.lines.join(', ')}. Replacing strict types with 'any' is blocked by firewall.`,
			},
		];
	}

	return [];
}

/**
 * Extracts test titles/names from test files.
 * Handles `test('name', ...)`, `it('name', ...)`, `describe('name', ...)`, `test.serial('name', ...)`, etc.
 */
function extractTestTitles(code: string): Set<string> {
	const titles = new Set<string>();

	// Matches test('...', ...), it('...', ...), describe('...', ...), test.serial('...', ...)
	const testPattern =
		/(?:\b(?:test|it|describe|suite|context)(?:\.[a-zA-Z0-9_$]+)*)\s*\(\s*(['"`])(.*?)\1/g;

	let match: RegExpExecArray | null = testPattern.exec(code);
	while (match !== null) {
		if (match[2]) {
			titles.add(match[2].trim());
		}
		match = testPattern.exec(code);
	}

	return titles;
}

/**
 * Detects deleted test blocks in test files.
 */
export function detectDeletedTestBlocks(
	filePath: string,
	oldContent: string,
	newContent: string,
): FirewallViolation[] {
	if (!TEST_FILE_PATTERN.test(filePath)) {
		return [];
	}

	const oldTitles = extractTestTitles(oldContent);
	const newTitles = extractTestTitles(newContent);

	const deletedTitles: string[] = [];
	for (const title of oldTitles) {
		if (!newTitles.has(title)) {
			deletedTitles.push(title);
		}
	}

	if (deletedTitles.length > 0) {
		return [
			{
				rule: 'protect_test_cases',
				filePath,
				message: `Detected deletion of ${deletedTitles.length} test case(s).`,
				details: `Deleted tests: ${deletedTitles.map(t => `"${t}"`).join(', ')}. Removing unit tests is blocked by firewall.`,
			},
		];
	}

	return [];
}

/**
 * Extracts top-level exported symbols from a source file.
 */
function extractExportedSymbols(code: string): Set<string> {
	const exports = new Set<string>();

	// Function / Class / Interface / Type / Enum
	const defPattern =
		/^[ \t]*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|abstract\s+class)\s+([a-zA-Z0-9_$]+)/gm;
	let match: RegExpExecArray | null = defPattern.exec(code);
	while (match !== null) {
		if (match[1]) exports.add(match[1]);
		match = defPattern.exec(code);
	}

	// Variables: export const foo = ..., export let bar = ...
	const varPattern = /^[ \t]*export\s+(?:const|let|var)\s+([a-zA-Z0-9_$]+)/gm;
	match = varPattern.exec(code);
	while (match !== null) {
		if (match[1]) exports.add(match[1]);
		match = varPattern.exec(code);
	}

	// Named export blocks: export { a, b as c, d }
	const blockPattern = /^[ \t]*export\s+\{([^}]+)\}/gm;
	match = blockPattern.exec(code);
	while (match !== null) {
		if (match[1]) {
			const items = match[1].split(',');
			for (const item of items) {
				const trimmed = item.trim();
				if (!trimmed) continue;
				// handle 'a as b'
				const parts = trimmed.split(/\s+as\s+/);
				const exportedName = (parts[1] || parts[0]).trim();
				if (exportedName) exports.add(exportedName);
			}
		}
		match = blockPattern.exec(code);
	}

	return exports;
}

/**
 * Detects deleted or removed exported symbols from code.
 */
export function detectExportSignatureModifications(
	filePath: string,
	oldContent: string,
	newContent: string,
): FirewallViolation[] {
	if (!/\.[jt]sx?$/i.test(filePath)) {
		return [];
	}

	// Skip test files for export signature check
	if (TEST_FILE_PATTERN.test(filePath)) {
		return [];
	}

	const oldExports = extractExportedSymbols(oldContent);
	const newExports = extractExportedSymbols(newContent);

	const removedExports: string[] = [];
	for (const name of oldExports) {
		if (!newExports.has(name)) {
			removedExports.push(name);
		}
	}

	if (removedExports.length > 0) {
		return [
			{
				rule: 'preserve_export_signatures',
				filePath,
				message: `Detected removal of ${removedExports.length} exported symbol(s).`,
				details: `Removed export(s): ${removedExports.map(e => `'${e}'`).join(', ')}. Breaking exported API contracts is blocked by firewall.`,
			},
		];
	}

	return [];
}
