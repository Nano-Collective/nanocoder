import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import type {FirewallViolation} from '@/types/firewall';

const TEST_FILE_PATTERN = /\.(spec|test)\.[jt]sx?$/i;
const nodeRequire = createRequire(import.meta.url);

// Cache dynamically resolved TypeScript compiler instance
let cachedTs: any = null;

/**
 * Resolves the TypeScript compiler API if available in the environment.
 * Gracefully falls back to null if no compatible TS compiler is found.
 */
function getTsCompiler(): any {
	if (cachedTs !== null) return cachedTs;
	try {
		const ts = nodeRequire('typescript');
		if (typeof ts?.createSourceFile === 'function') {
			cachedTs = ts;
			return cachedTs;
		}
	} catch {}

	try {
		const pnpmDir = path.join(process.cwd(), 'node_modules/.pnpm');
		if (fs.existsSync(pnpmDir)) {
			const entries = fs
				.readdirSync(pnpmDir)
				.filter((e: string) => e.startsWith('typescript@5.'));
			if (entries.length > 0) {
				const fullPath = path.join(
					pnpmDir,
					entries[0],
					'node_modules/typescript/lib/typescript.js',
				);
				if (fs.existsSync(fullPath)) {
					cachedTs = nodeRequire(fullPath);
					return cachedTs;
				}
			}
		}
	} catch {}

	return null;
}

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

function findAnyOccurrencesWithTs(
	ts: any,
	code: string,
	filePath: string,
): AnyOccurrence[] {
	const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);
	const occurrences: AnyOccurrence[] = [];

	function getAnchorPath(node: any): string {
		const parts: string[] = [];
		let curr = node.parent;
		while (curr && curr !== sf) {
			if (curr.name && (curr.name.text || curr.name.escapedText)) {
				const name = curr.name.text || curr.name.escapedText;
				parts.unshift(`${ts.SyntaxKind[curr.kind] || 'node'}:${name}`);
			} else if (
				ts.isFunctionDeclaration?.(curr) ||
				ts.isMethodDeclaration?.(curr) ||
				ts.isFunctionExpression?.(curr) ||
				ts.isArrowFunction?.(curr)
			) {
				const name = curr.name?.text || curr.name?.escapedText || 'anonymous';
				parts.unshift(`fn:${name}`);
			} else if (ts.isParameter?.(curr)) {
				const name = curr.name?.getText ? curr.name.getText(sf) : 'param';
				parts.unshift(`param:${name}`);
			} else if (ts.isVariableDeclaration?.(curr)) {
				const name = curr.name?.getText ? curr.name.getText(sf) : 'var';
				parts.unshift(`var:${name}`);
			} else if (
				ts.isPropertySignature?.(curr) ||
				ts.isPropertyDeclaration?.(curr)
			) {
				const name = curr.name?.getText ? curr.name.getText(sf) : 'prop';
				parts.unshift(`prop:${name}`);
			} else if (ts.isTypeAliasDeclaration?.(curr)) {
				const name = curr.name?.text || 'type';
				parts.unshift(`type:${name}`);
			} else if (ts.isInterfaceDeclaration?.(curr)) {
				const name = curr.name?.text || 'interface';
				parts.unshift(`interface:${name}`);
			} else if (ts.isAsExpression?.(curr)) {
				parts.unshift('as');
			} else {
				parts.unshift(ts.SyntaxKind[curr.kind] || 'node');
			}
			curr = curr.parent;
		}
		return parts.join(' > ');
	}

	function visit(node: any) {
		if (node.kind === ts.SyntaxKind.AnyKeyword) {
			const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
			occurrences.push({
				line: pos.line + 1,
				anchor: getAnchorPath(node),
				text: node.getText(sf),
			});
		}
		ts.forEachChild(node, visit);
	}

	visit(sf);
	return occurrences;
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

	const ts = getTsCompiler();
	const oldAnys = ts
		? findAnyOccurrencesWithTs(ts, oldContent, filePath)
		: findAnyOccurrencesLexical(oldContent);
	const newAnys = ts
		? findAnyOccurrencesWithTs(ts, newContent, filePath)
		: findAnyOccurrencesLexical(newContent);

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
				details: `Found newly introduced 'any' at line(s): ${lineList}. Replacing strict types with 'any' is blocked by firewall.`,
			},
		];
	}

	return [];
}

// ============================================================================
// Rule 2: Test Block Deletion Detection (Multiplicity Preserving)
// ============================================================================

function extractTestTitlesWithTs(
	ts: any,
	code: string,
	filePath: string,
): string[] {
	const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);
	const tests: string[] = [];
	const suiteStack: string[] = [];

	const TEST_NAMES = new Set(['test', 'it']);
	const SUITE_NAMES = new Set(['describe', 'suite', 'context']);

	function getCallCalleeName(expr: any): string {
		if (ts.isIdentifier?.(expr)) return expr.text;
		if (ts.isPropertyAccessExpression?.(expr)) {
			const base = getCallCalleeName(expr.expression);
			return base ? `${base}.${expr.name.text}` : expr.name.text;
		}
		return '';
	}

	function getBaseCallee(callee: string): string {
		return callee.split('.')[0];
	}

	function visit(node: any) {
		if (ts.isCallExpression?.(node)) {
			const callee = getCallCalleeName(node.expression);
			const base = getBaseCallee(callee);
			const firstArg = node.arguments?.[0];

			let title = '';
			if (
				firstArg &&
				(ts.isStringLiteral?.(firstArg) ||
					ts.isNoSubstitutionTemplateLiteral?.(firstArg))
			) {
				title = firstArg.text;
			}

			if (SUITE_NAMES.has(base) && title) {
				suiteStack.push(title);
				ts.forEachChild(node, visit);
				suiteStack.pop();
				return;
			}

			if (TEST_NAMES.has(base) && title) {
				const fullTitle =
					suiteStack.length > 0
						? `${suiteStack.join(' > ')} > ${title}`
						: title;
				tests.push(fullTitle);
			}
		}
		ts.forEachChild(node, visit);
	}

	visit(sf);
	return tests;
}

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

	const ts = getTsCompiler();
	const oldTitles = ts
		? extractTestTitlesWithTs(ts, oldContent, filePath)
		: extractTestTitlesLexical(oldContent);
	const newTitles = ts
		? extractTestTitlesWithTs(ts, newContent, filePath)
		: extractTestTitlesLexical(newContent);

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

function extractExportSignaturesWithTs(
	ts: any,
	code: string,
	filePath: string,
): Map<string, ExportedItem[]> {
	const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);
	const signatures = new Map<string, ExportedItem[]>();

	function isExported(node: any): boolean {
		if (!node.modifiers) return false;
		return node.modifiers.some(
			(m: any) => m.kind === ts.SyntaxKind.ExportKeyword,
		);
	}

	function isDefault(node: any): boolean {
		if (!node.modifiers) return false;
		return node.modifiers.some(
			(m: any) => m.kind === ts.SyntaxKind.DefaultKeyword,
		);
	}

	function formatParams(params: any[]): string {
		return params
			.map(p => {
				const dotDotDot = p.dotDotDotToken ? '...' : '';
				const name = p.name ? p.name.getText(sf) : 'param';
				const question = p.questionToken ? '?' : '';
				const type = p.type
					? `: ${normalizeWhitespace(p.type.getText(sf))}`
					: '';
				return `${dotDotDot}${name}${question}${type}`;
			})
			.join(', ');
	}

	function formatTypeParams(tps: any[] | undefined): string {
		if (!tps || tps.length === 0) return '';
		return `<${tps.map(tp => normalizeWhitespace(tp.getText(sf))).join(', ')}>`;
	}

	for (const stmt of sf.statements) {
		// 1. FunctionDeclaration
		if (ts.isFunctionDeclaration?.(stmt) && isExported(stmt)) {
			const def = isDefault(stmt);
			const name = stmt.name ? stmt.name.text : def ? 'default' : 'anonymous';
			const retType = stmt.type
				? `: ${normalizeWhitespace(stmt.type.getText(sf))}`
				: '';
			const sig = `${def ? 'default ' : ''}function ${name}${formatTypeParams(stmt.typeParameters)}(${formatParams(stmt.parameters || [])})${retType}`;
			const key = def ? 'default' : name;
			const list = signatures.get(key) || [];
			list.push({kind: 'function', name: key, signature: sig});
			signatures.set(key, list);
		}
		// 2. InterfaceDeclaration
		else if (ts.isInterfaceDeclaration?.(stmt) && isExported(stmt)) {
			const name = stmt.name.text;
			const heritage = stmt.heritageClauses
				? ` ${normalizeWhitespace(stmt.heritageClauses.map((h: any) => h.getText(sf)).join(' '))}`
				: '';
			const members = (stmt.members || [])
				.map((m: any) => normalizeWhitespace(m.getText(sf)))
				.sort()
				.join('; ');
			const sig = `interface ${name}${formatTypeParams(stmt.typeParameters)}${heritage} { ${members} }`;
			signatures.set(name, [{kind: 'interface', name, signature: sig}]);
		}
		// 3. TypeAliasDeclaration
		else if (ts.isTypeAliasDeclaration?.(stmt) && isExported(stmt)) {
			const name = stmt.name.text;
			const sig = `type ${name}${formatTypeParams(stmt.typeParameters)} = ${normalizeWhitespace(stmt.type.getText(sf))}`;
			signatures.set(name, [{kind: 'type', name, signature: sig}]);
		}
		// 4. ClassDeclaration
		else if (ts.isClassDeclaration?.(stmt) && isExported(stmt)) {
			const def = isDefault(stmt);
			const name = stmt.name ? stmt.name.text : def ? 'default' : 'anonymous';
			const heritage = stmt.heritageClauses
				? ` ${normalizeWhitespace(stmt.heritageClauses.map((h: any) => h.getText(sf)).join(' '))}`
				: '';
			const members = (stmt.members || [])
				.map((m: any) => {
					if (ts.isMethodDeclaration?.(m) || ts.isConstructorDeclaration?.(m)) {
						const mName = m.name ? m.name.getText(sf) : 'constructor';
						const mRet = m.type
							? `: ${normalizeWhitespace(m.type.getText(sf))}`
							: '';
						return `${mName}${formatTypeParams(m.typeParameters)}(${formatParams(m.parameters || [])})${mRet}`;
					}
					if (ts.isPropertyDeclaration?.(m)) {
						const pName = m.name ? m.name.getText(sf) : 'prop';
						const pType = m.type
							? `: ${normalizeWhitespace(m.type.getText(sf))}`
							: '';
						return `${pName}${pType}`;
					}
					return normalizeWhitespace(m.getText(sf));
				})
				.sort()
				.join('; ');
			const sig = `${def ? 'default ' : ''}class ${name}${formatTypeParams(stmt.typeParameters)}${heritage} { ${members} }`;
			const key = def ? 'default' : name;
			signatures.set(key, [{kind: 'class', name: key, signature: sig}]);
		}
		// 5. VariableStatement
		else if (ts.isVariableStatement?.(stmt) && isExported(stmt)) {
			for (const decl of stmt.declarationList?.declarations || []) {
				const name = decl.name ? decl.name.getText(sf) : 'var';
				const type = decl.type
					? normalizeWhitespace(decl.type.getText(sf))
					: decl.initializer
						? `inferred:${normalizeWhitespace(decl.initializer.getText(sf))}`
						: 'any';
				const sig = `var ${name}: ${type}`;
				signatures.set(name, [{kind: 'variable', name, signature: sig}]);
			}
		}
		// 6. Named export block: export { a as b }
		else if (ts.isExportDeclaration?.(stmt)) {
			if (stmt.exportClause && ts.isNamedExports?.(stmt.exportClause)) {
				for (const elem of stmt.exportClause.elements || []) {
					const expName = elem.name?.text || '';
					const propName = elem.propertyName ? elem.propertyName.text : expName;
					const sig = `export { ${propName} as ${expName} }`;
					signatures.set(expName, [
						{kind: 'namedExport', name: expName, signature: sig},
					]);
				}
			}
		}
		// 7. Default export assignment: export default foo
		else if (ts.isExportAssignment?.(stmt)) {
			const sig = `default = ${normalizeWhitespace(stmt.expression.getText(sf))}`;
			signatures.set('default', [
				{kind: 'defaultExport', name: 'default', signature: sig},
			]);
		}
	}

	return signatures;
}

function extractExportSignaturesLexical(
	code: string,
): Map<string, ExportedItem[]> {
	const signatures = new Map<string, ExportedItem[]>();
	const cleaned = stripCommentsAndStrings(code);

	// Match export function, class, interface, type, const, let
	const defPattern =
		/^[ \t]*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|abstract\s+class)\s+([a-zA-Z0-9_$]+)([^{=;]*)/gm;
	let match = defPattern.exec(cleaned);
	while (match !== null) {
		const name = match[1];
		const header = normalizeWhitespace(match[0]);
		signatures.set(name, [{kind: 'def', name, signature: header}]);
		match = defPattern.exec(cleaned);
	}

	const varPattern =
		/^[ \t]*export\s+(?:const|let|var)\s+([a-zA-Z0-9_$]+)(?:\s*:\s*([^=;]+))?/gm;
	match = varPattern.exec(cleaned);
	while (match !== null) {
		const name = match[1];
		const type = match[2] ? normalizeWhitespace(match[2]) : 'inferred';
		signatures.set(name, [
			{kind: 'var', name, signature: `var ${name}: ${type}`},
		]);
		match = varPattern.exec(cleaned);
	}

	const blockPattern = /^[ \t]*export\s+\{([^}]+)\}/gm;
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
					signatures.set(expName, [
						{kind: 'named', name: expName, signature: `export { ${trimmed} }`},
					]);
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

	const ts = getTsCompiler();
	const oldSigs = ts
		? extractExportSignaturesWithTs(ts, oldContent, filePath)
		: extractExportSignaturesLexical(oldContent);
	const newSigs = ts
		? extractExportSignaturesWithTs(ts, newContent, filePath)
		: extractExportSignaturesLexical(newContent);

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
