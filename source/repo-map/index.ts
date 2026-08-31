import {readFile} from 'node:fs/promises';
import {extname} from 'node:path';
import {walkProjectEntries} from '@/utils/file-search';
import {calculateTokens} from '@/utils/token-calculator';

export interface RepoMapFile {
	path: string;
	rank: number;
	symbols: string[];
}

export interface RepoMap {
	files: RepoMapFile[];
	scannedFiles: number;
	totalSymbols: number;
	truncated: boolean;
}

export interface RepoMapOptions {
	maxTokens?: number;
	maxFiles?: number;
	maxFileBytes?: number;
	maxSymbolsPerFile?: number;
}

export const DEFAULT_REPO_MAP_TOKENS = 1024;
const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_SYMBOLS_PER_FILE = 12;
const DAMPING = 0.85;
const MAX_ITERATIONS = 24;
const CONVERGENCE = 1e-6;

const DEFINITION_PATTERNS: Record<string, RegExp[]> = {
	js: [
		/^export[ \t]+(?:default[ \t]+)?(?:declare[ \t]+)?(?:abstract[ \t]+)?(?:async[ \t]+)?(?:function\*?|class)[ \t]+([A-Za-z_$][\w$]*)/gm,
		/^export[ \t]+(?:declare[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*[=:]/gm,
		/^export[ \t]+(?:declare[ \t]+)?(?:interface|type|enum|namespace)[ \t]+([A-Za-z_$][\w$]*)[ \t]*[<={]/gm,
		/^(?:module\.)?exports\.([A-Za-z_$][\w$]*)[ \t]*=/gm,
		/^[ \t]+(?:(?:public|private|protected|static|async|readonly|get|set|\*)[ \t]+)*([A-Za-z_$][\w$]*)[ \t]*\([^)\n]*\)[ \t]*[:{]/gm,
	],
	py: [
		/^[ \t]*(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)/gm,
		/^[ \t]*class[ \t]+([A-Za-z_]\w*)/gm,
	],
	go: [/\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g, /\btype\s+([A-Za-z_]\w*)/g],
	rs: [/\b(?:fn|struct|enum|trait|union|mod)\s+([A-Za-z_]\w*)/g],
	java: [
		/\b(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/g,
		/^[ \t]*(?:(?:public|private|protected|static|final|abstract|synchronized|override|open|fun)[ \t]+)+[\w<>,.[\] ]*?([A-Za-z_]\w*)[ \t]*\(/gm,
	],
	rb: [/^[ \t]*(?:def|class|module)[ \t]+(?:self\.)?([A-Za-z_]\w*)/gm],
	php: [/\b(?:function|class|interface|trait|enum)\s+([A-Za-z_]\w*)/g],
	c: [
		/\b(?:struct|union|enum|class)\s+([A-Za-z_]\w*)/g,
		/^[A-Za-z_][\w \t*&:]*?\b([A-Za-z_]\w*)[ \t]*\([^;)]*\)[ \t]*\{?[ \t]*$/gm,
	],
};

const EXTENSION_LANGUAGES: Record<string, string> = {
	'.js': 'js',
	'.jsx': 'js',
	'.mjs': 'js',
	'.cjs': 'js',
	'.ts': 'js',
	'.tsx': 'js',
	'.mts': 'js',
	'.cts': 'js',
	'.py': 'py',
	'.pyi': 'py',
	'.go': 'go',
	'.rs': 'rs',
	'.java': 'java',
	'.kt': 'java',
	'.cs': 'java',
	'.scala': 'java',
	'.swift': 'java',
	'.rb': 'rb',
	'.php': 'php',
	'.c': 'c',
	'.h': 'c',
	'.cc': 'c',
	'.cpp': 'c',
	'.cxx': 'c',
	'.hpp': 'c',
};

const IMPORT_PATTERNS: Record<string, RegExp[]> = {
	js: [
		/^[ \t]*(?:import|export)[ \t]+(?:type[ \t]+)?([\w${},*\s]*?)[ \t]from[ \t]/gm,
		/^[ \t]*(?:const|let|var)[ \t]+([\w${},:\s]*?)=[ \t]*(?:await[ \t]+)?require[ \t]*\(/gm,
	],
	py: [/^[ \t]*(?:from[ \t]+[\w.]+[ \t]+)?import[ \t]+([^\n]*)/gm],
	rs: [/\buse\b([^;]*);/g],
	php: [/\buse\b([^;]*);/g],
};

const HASH_COMMENT_LANGUAGES = new Set(['py', 'rb']);

const KEYWORDS = new Set([
	'abstract',
	'and',
	'any',
	'as',
	'assert',
	'async',
	'await',
	'bool',
	'boolean',
	'break',
	'byte',
	'case',
	'catch',
	'char',
	'class',
	'const',
	'constructor',
	'continue',
	'debugger',
	'def',
	'default',
	'del',
	'delete',
	'do',
	'double',
	'elif',
	'else',
	'end',
	'enum',
	'except',
	'export',
	'extends',
	'extern',
	'false',
	'final',
	'finally',
	'float',
	'fn',
	'for',
	'from',
	'fun',
	'func',
	'function',
	'global',
	'go',
	'if',
	'impl',
	'implements',
	'import',
	'in',
	'infer',
	'init',
	'instanceof',
	'int',
	'interface',
	'is',
	'keyof',
	'lambda',
	'let',
	'long',
	'match',
	'mod',
	'module',
	'mut',
	'namespace',
	'new',
	'nil',
	'none',
	'not',
	'null',
	'number',
	'object',
	'open',
	'or',
	'override',
	'package',
	'pass',
	'private',
	'protected',
	'pub',
	'public',
	'raise',
	'range',
	'readonly',
	'record',
	'ref',
	'require',
	'return',
	'satisfies',
	'self',
	'short',
	'sizeof',
	'static',
	'string',
	'struct',
	'super',
	'switch',
	'symbol',
	'synchronized',
	'this',
	'throw',
	'trait',
	'true',
	'try',
	'type',
	'typedef',
	'typeof',
	'undefined',
	'union',
	'unknown',
	'unsafe',
	'use',
	'using',
	'var',
	'void',
	'when',
	'where',
	'while',
	'with',
	'yield',
]);

const IDENTIFIER = /(?<![.\w$])[A-Za-z_$][\w$]*/g;
const BASE_NOISE =
	/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
// Triple-quoted forms must lead: alternation is left-to-right, so a `"..."`
// branch placed first matches the empty string inside `"""` and the docstring
// body would survive stripping.
const HASH_NOISE =
	/"""[\s\S]*?"""|'''[\s\S]*?'''|#[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

function stripNoise(source: string, language: string): string {
	const pattern = HASH_COMMENT_LANGUAGES.has(language)
		? HASH_NOISE
		: BASE_NOISE;
	pattern.lastIndex = 0;
	return source.replace(/\r\n?/g, '\n').replace(pattern, ' ');
}

function languageFor(filePath: string): string | undefined {
	return EXTENSION_LANGUAGES[extname(filePath).toLowerCase()];
}

function extractDefinitions(source: string, language: string): Set<string> {
	const names = new Set<string>();
	for (const pattern of DEFINITION_PATTERNS[language] ?? []) {
		pattern.lastIndex = 0;
		let match = pattern.exec(source);
		while (match !== null) {
			const name = match[1];
			if (name && name.length > 1 && !KEYWORDS.has(name)) {
				names.add(name);
			}
			match = pattern.exec(source);
		}
	}
	return names;
}

function collectIdentifiers(source: string, into: Map<string, number>): void {
	IDENTIFIER.lastIndex = 0;
	let match = IDENTIFIER.exec(source);
	while (match !== null) {
		const name = match[0];
		if (name.length > 1 && !KEYWORDS.has(name)) {
			into.set(name, (into.get(name) ?? 0) + 1);
		}
		match = IDENTIFIER.exec(source);
	}
}

function countReferences(
	source: string,
	language: string,
): Map<string, number> {
	const counts = new Map<string, number>();
	collectIdentifiers(source, counts);

	const importPatterns = IMPORT_PATTERNS[language];
	if (!importPatterns) {
		return counts;
	}

	const imported = new Map<string, number>();
	for (const pattern of importPatterns) {
		pattern.lastIndex = 0;
		let match = pattern.exec(source);
		while (match !== null) {
			collectIdentifiers(match[1] ?? '', imported);
			match = pattern.exec(source);
		}
	}
	for (const name of counts.keys()) {
		if (!imported.has(name)) {
			counts.delete(name);
		}
	}
	return counts;
}

interface ScannedFile {
	path: string;
	definitions: Set<string>;
	references: Map<string, number>;
}

async function scanFiles(
	cwd: string,
	maxFiles: number,
	maxFileBytes: number,
): Promise<{files: ScannedFile[]; truncated: boolean}> {
	const files: ScannedFile[] = [];
	let truncated = false;

	const walkResult = await walkProjectEntries(
		cwd,
		undefined,
		async entry => {
			const language = languageFor(entry.relativePath);
			if (!language) {
				return false;
			}
			// Checked before the push so a repo holding exactly `maxFiles` indexable
			// files is not reported as truncated.
			if (files.length >= maxFiles) {
				truncated = true;
				return true;
			}

			let source: string;
			try {
				source = await readFile(entry.absolutePath, 'utf-8');
			} catch {
				return false;
			}
			if (source.length > maxFileBytes) {
				return false;
			}

			const stripped = stripNoise(source, language);
			files.push({
				path: entry.relativePath.replace(/\\/g, '/'),
				definitions: extractDefinitions(stripped, language),
				references: countReferences(stripped, language),
			});

			return false;
		},
		false,
	);
	truncated = truncated || walkResult.truncated;

	return {files, truncated};
}

function pageRank(
	nodeCount: number,
	edges: Map<number, Map<number, number>>,
): number[] {
	if (nodeCount === 0) {
		return [];
	}

	const base = 1 / nodeCount;
	const outWeight = new Array<number>(nodeCount).fill(0);
	for (const [from, targets] of edges) {
		let total = 0;
		for (const weight of targets.values()) {
			total += weight;
		}
		outWeight[from] = total;
	}

	let ranks = new Array<number>(nodeCount).fill(base);
	for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
		const next = new Array<number>(nodeCount).fill(0);
		let dangling = 0;
		for (let node = 0; node < nodeCount; node++) {
			if (outWeight[node] === 0) {
				dangling += ranks[node];
			}
		}
		for (const [from, targets] of edges) {
			const total = outWeight[from];
			for (const [to, weight] of targets) {
				next[to] += (ranks[from] * weight) / total;
			}
		}

		let delta = 0;
		for (let node = 0; node < nodeCount; node++) {
			const value =
				(1 - DAMPING) * base + DAMPING * (next[node] + dangling * base);
			delta += Math.abs(value - ranks[node]);
			next[node] = value;
		}
		ranks = next;
		if (delta < CONVERGENCE) {
			break;
		}
	}
	return ranks;
}

export async function buildRepoMap(
	cwd: string,
	options: RepoMapOptions = {},
): Promise<RepoMap> {
	const maxTokens = options.maxTokens ?? DEFAULT_REPO_MAP_TOKENS;
	const maxSymbolsPerFile =
		options.maxSymbolsPerFile ?? DEFAULT_MAX_SYMBOLS_PER_FILE;
	const {files, truncated} = await scanFiles(
		cwd,
		options.maxFiles ?? DEFAULT_MAX_FILES,
		options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
	);

	const definers = new Map<string, number[]>();
	files.forEach((file, index) => {
		for (const name of file.definitions) {
			const existing = definers.get(name);
			if (existing) {
				existing.push(index);
			} else {
				definers.set(name, [index]);
			}
		}
	});

	const edges = new Map<number, Map<number, number>>();
	const symbolWeights = files.map(() => new Map<string, number>());
	files.forEach((file, from) => {
		for (const [name, count] of file.references) {
			const targets = definers.get(name);
			if (!targets || file.definitions.has(name)) {
				continue;
			}
			const share = Math.sqrt(count) / targets.length;
			let row = edges.get(from);
			if (!row) {
				row = new Map<number, number>();
				edges.set(from, row);
			}
			for (const to of targets) {
				row.set(to, (row.get(to) ?? 0) + share);
				symbolWeights[to].set(name, (symbolWeights[to].get(name) ?? 0) + share);
			}
		}
	});

	const ranks = pageRank(files.length, edges);
	const ordered = files
		.map((file, index) => ({file, index, rank: ranks[index] ?? 0}))
		.sort((a, b) =>
			b.rank === a.rank
				? a.file.path.localeCompare(b.file.path)
				: b.rank - a.rank,
		);

	const selected: RepoMapFile[] = [];
	let usedTokens = 0;
	let budgetTruncated = false;
	for (const {file, index, rank} of ordered) {
		if (file.definitions.size === 0) {
			continue;
		}
		const weights = symbolWeights[index];
		const symbols = [...file.definitions]
			.sort((a, b) => {
				const diff = (weights.get(b) ?? 0) - (weights.get(a) ?? 0);
				return diff === 0 ? a.localeCompare(b) : diff;
			})
			.slice(0, maxSymbolsPerFile);
		const cost = calculateTokens(`${file.path}\n${symbols.join(' ')}\n`);
		if (usedTokens + cost > maxTokens) {
			budgetTruncated = true;
			break;
		}
		usedTokens += cost;
		selected.push({path: file.path, rank, symbols});
	}

	return {
		files: selected,
		scannedFiles: files.length,
		totalSymbols: files.reduce((sum, file) => sum + file.definitions.size, 0),
		truncated: truncated || budgetTruncated,
	};
}
