import type {FirewallViolation} from '@/types/firewall';

const TEST_FILE_PATTERN = /\.(spec|test)\.[jt]sx?$/i;

/**
 * Strips comments and string literals across lines while preserving line indices.
 */
function stripCommentsAndStrings(code: string): string {
	return code
		.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\r\n]/g, ' '))
		.replace(/\/\/.*$/gm, match => match.replace(/[^\r\n]/g, ' '))
		.replace(/(["'`])(?:(?=(\\?))\2[\s\S])*?\1/g, match =>
			match.replace(/[^\r\n]/g, ' '),
		);
}

function stripCommentsOnly(code: string): string {
	return code
		.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\r\n]/g, ' '))
		.replace(/\/\/.*$/gm, match => match.replace(/[^\r\n]/g, ' '));
}

function normalizeWhitespace(str: string): string {
	return str.replace(/\s+/g, ' ').trim();
}

// ============================================================================
// Rule 1: Explicit Any Detection
// ============================================================================

interface AnyOccurrence {
	line: number;
	anchor: string;
	text: string;
}

function findAnyOccurrencesLexical(code: string): AnyOccurrence[] {
	const cleaned = stripCommentsAndStrings(code);
	const lines = cleaned.split('\n');
	const occurrences: AnyOccurrence[] = [];

	const anyPattern =
		/(?::\s*any\b(?!\s*\[)|as\s+any\b(?!\s*\[)|[,<]\s*any\s*[,>]|\bany\s*\[\s*\])/g;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		let match = anyPattern.exec(line);
		while (match !== null) {
			occurrences.push({
				line: i + 1,
				anchor: `line:${i + 1}:${match.index}`,
				text: match[0],
			});
			match = anyPattern.exec(line);
		}
	}

	return occurrences;
}

/**
 * Detects newly introduced `any` types in TypeScript/JavaScript files.
 * Identifies syntax nodes/anchors rather than raw aggregate counts.
 */
export function detectAnyTypeInjections(
	filePath: string,
	oldContent: string,
	newContent: string,
): FirewallViolation[] {
	if (!/\.[jt]sx?$/i.test(filePath) || oldContent.length === 0) {
		return [];
	}

	const oldAnys = findAnyOccurrencesLexical(oldContent);
	const newAnys = findAnyOccurrencesLexical(newContent);

	const oldAnchorCounts = new Map<string, number>();
	for (const a of oldAnys) {
		oldAnchorCounts.set(a.anchor, (oldAnchorCounts.get(a.anchor) || 0) + 1);
	}

	const newAnchorCounts = new Map<string, number>();
	const newlyInjected: AnyOccurrence[] = [];

	for (const a of newAnys) {
		const seen = newAnchorCounts.get(a.anchor) || 0;
		const available = oldAnchorCounts.get(a.anchor) || 0;
		if (seen >= available) {
			newlyInjected.push(a);
		}
		newAnchorCounts.set(a.anchor, seen + 1);
	}

	if (newlyInjected.length > 0) {
		const lineList = Array.from(new Set(newlyInjected.map(a => a.line))).join(
			', ',
		);
		return [
			{
				rule: 'block_any_types',
				filePath,
				message: `Injected ${newlyInjected.length} explicit 'any' type annotation(s).`,
				details: `Line(s): ${lineList}. Explicit 'any' types degrade type safety and are blocked by firewall.`,
			},
		];
	}

	return [];
}

// ============================================================================
// Rule 2: Deleted Test Block Detection
// ============================================================================

function extractTestTitlesLexical(code: string): string[] {
	const cleaned = stripCommentsOnly(code);
	const titles: string[] = [];

	const testPattern =
		/(?:\b(?:test|it)(?:\.[a-zA-Z0-9_$]+)*)\s*\(\s*(['"`])(.*?)\1/g;

	let match = testPattern.exec(cleaned);
	while (match !== null) {
		if (match[2] !== undefined) {
			titles.push(match[2].trim());
		}
		match = testPattern.exec(cleaned);
	}

	return titles;
}

/**
 * Detects deleted test blocks in test files, preserving multiplicity for duplicate titles.
 */
export function detectDeletedTestBlocks(
	filePath: string,
	oldContent: string,
	newContent: string,
): FirewallViolation[] {
	if (!TEST_FILE_PATTERN.test(filePath)) {
		return [];
	}

	const oldTitles = extractTestTitlesLexical(oldContent);
	const newTitles = extractTestTitlesLexical(newContent);

	const oldCounts = new Map<string, number>();
	for (const t of oldTitles) {
		oldCounts.set(t, (oldCounts.get(t) || 0) + 1);
	}

	const newCounts = new Map<string, number>();
	for (const t of newTitles) {
		newCounts.set(t, (newCounts.get(t) || 0) + 1);
	}

	const deletedTitles: string[] = [];
	for (const [title, count] of oldCounts.entries()) {
		const newCount = newCounts.get(title) || 0;
		if (newCount < count) {
			const diff = count - newCount;
			for (let i = 0; i < diff; i++) {
				deletedTitles.push(title);
			}
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

// ============================================================================
// Rule 3: Export Signature Modification & Removal Detection
// ============================================================================

interface ExportedItem {
	kind: string;
	name: string;
	signature: string;
}

function extractExportSignaturesLexical(
	code: string,
): Map<string, ExportedItem[]> {
	const signatures = new Map<string, ExportedItem[]>();
	const cleaned = stripCommentsAndStrings(code);

	// 1. Interfaces (contract includes members)
	const interfacePattern =
		/(?:^|\n)[ \t]*export\s+(?:interface)\s+([a-zA-Z0-9_$]+)(?:<[\s\S]*?>)?(?:\s+extends\s+[^{]+)?\s*\{([\s\S]*?)\}/g;
	let match = interfacePattern.exec(cleaned);
	while (match !== null) {
		const name = match[1];
		const header = normalizeWhitespace(match[0]);
		const existing = signatures.get(name) || [];
		existing.push({kind: 'interface', name, signature: header});
		signatures.set(name, existing);
		match = interfacePattern.exec(cleaned);
	}

	// 2. Type aliases (contract includes alias target)
	const typePattern =
		/(?:^|\n)[ \t]*export\s+(?:type)\s+([a-zA-Z0-9_$]+)([\s\S]*?)(?:;|\n(?=[ \t]*(?:export|$))|$)/g;
	match = typePattern.exec(cleaned);
	while (match !== null) {
		const name = match[1];
		const header = normalizeWhitespace(match[0]);
		const existing = signatures.get(name) || [];
		existing.push({kind: 'type', name, signature: header});
		signatures.set(name, existing);
		match = typePattern.exec(cleaned);
	}

	// 3. Enums (contract includes member names)
	const enumPattern =
		/(?:^|\n)[ \t]*export\s+(?:const\s+)?(?:enum)\s+([a-zA-Z0-9_$]+)\s*\{([\s\S]*?)\}/g;
	match = enumPattern.exec(cleaned);
	while (match !== null) {
		const name = match[1];
		const header = normalizeWhitespace(match[0]);
		const existing = signatures.get(name) || [];
		existing.push({kind: 'enum', name, signature: header});
		signatures.set(name, existing);
		match = enumPattern.exec(cleaned);
	}

	// 4. Functions & classes (contract is signature header before body {)
	const fnClassPattern =
		/(?:^|\n)[ \t]*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|abstract\s+class)\s+([a-zA-Z0-9_$]+)([\s\S]*?)(?=[{;]|$)/g;
	match = fnClassPattern.exec(cleaned);
	while (match !== null) {
		const name = match[1];
		const header = normalizeWhitespace(match[0]);
		const existing = signatures.get(name) || [];
		existing.push({kind: 'def', name, signature: header});
		signatures.set(name, existing);
		match = fnClassPattern.exec(cleaned);
	}

	// 5. Variables (const/let/var)
	const varPattern =
		/(?:^|\n)[ \t]*export\s+(?:const|let|var)\s+([a-zA-Z0-9_$]+)(?:\s*:\s*([^=;\n]+))?/g;
	match = varPattern.exec(cleaned);
	while (match !== null) {
		const name = match[1];
		const type = match[2] ? normalizeWhitespace(match[2]) : 'inferred';
		const existing = signatures.get(name) || [];
		existing.push({kind: 'var', name, signature: `var ${name}: ${type}`});
		signatures.set(name, existing);
		match = varPattern.exec(cleaned);
	}

	// 6. Export blocks: export { a, b as c }
	const blockPattern = /(?:^|\n)[ \t]*export\s+\{([\s\S]*?)\}/g;
	match = blockPattern.exec(cleaned);
	while (match !== null) {
		if (match[1]) {
			const items = match[1].split(',');
			for (const item of items) {
				const trimmed = item.trim();
				if (!trimmed) continue;
				const parts = trimmed.split(/\s+as\s+/);
				const expName = (parts[1] || parts[0]).trim();
				if (expName) {
					const existing = signatures.get(expName) || [];
					existing.push({
						kind: 'named',
						name: expName,
						signature: `export { ${trimmed} }`,
					});
					signatures.set(expName, existing);
				}
			}
		}
		match = blockPattern.exec(cleaned);
	}

	return signatures;
}

/**
 * Detects deleted, removed, or signature-modified exported symbols from TypeScript/JavaScript files.
 * Ignores implementation-body-only modifications while strictly protecting public signatures.
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

	const oldSigs = extractExportSignaturesLexical(oldContent);
	const newSigs = extractExportSignaturesLexical(newContent);

	const removedSymbols: string[] = [];
	const changedSignatures: Array<{name: string; from: string; to: string}> = [];

	for (const [name, oldItems] of oldSigs.entries()) {
		const newItems = newSigs.get(name);
		if (!newItems || newItems.length === 0) {
			removedSymbols.push(name);
			continue;
		}

		const oldSigSummary = oldItems
			.map(i => i.signature)
			.sort()
			.join(' | ');
		const newSigSummary = newItems
			.map(i => i.signature)
			.sort()
			.join(' | ');

		if (oldSigSummary !== newSigSummary) {
			changedSignatures.push({
				name,
				from: oldSigSummary,
				to: newSigSummary,
			});
		}
	}

	const violations: FirewallViolation[] = [];

	if (removedSymbols.length > 0) {
		violations.push({
			rule: 'preserve_export_signatures',
			filePath,
			message: `Detected removal of ${removedSymbols.length} exported symbol(s).`,
			details: `Removed export(s): ${removedSymbols.map(e => `'${e}'`).join(', ')}. Breaking exported API contracts is blocked by firewall.`,
		});
	}

	if (changedSignatures.length > 0) {
		const detailsList = changedSignatures
			.map(c => `'${c.name}': from '${c.from}' to '${c.to}'`)
			.join('; ');
		violations.push({
			rule: 'preserve_export_signatures',
			filePath,
			message: `Detected contract modification in ${changedSignatures.length} exported signature(s).`,
			details: `Changed export signature(s): ${detailsList}. Altering public API types or parameters is blocked by firewall.`,
		});
	}

	return violations;
}
